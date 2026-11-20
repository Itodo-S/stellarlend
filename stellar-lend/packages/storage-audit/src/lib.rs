//! Shared Soroban storage-layout auditing primitives.
//!
//! Contracts register the keys they read and write with an [`AuditReport`].
//! The report enforces the rules documented in `docs/storage.md`: unique key
//! names, stable persistent storage for critical state, collision-free key
//! namespaces, and append-only layouts. It is `no_std` so it can be linked
//! into contract crates as well as used by offline audit tooling.

#![no_std]

extern crate alloc;

use alloc::vec::Vec as AuditVec;
use soroban_sdk::{contracttype, symbol_short, Env, Symbol};

/// Storage tier a key is persisted in.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StorageTier {
    Persistent,
    Instance,
    Temporary,
}

/// Whether a value is critical protocol state that must never expire.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StateClass {
    Critical,
    Configuration,
    Cache,
    Transient,
}

/// One audited storage key declaration.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorageKeyEntry {
    pub namespace: Symbol,
    pub key: Symbol,
    pub tier: StorageTier,
    pub class: StateClass,
    pub field_count: u32,
    pub packed: bool,
}

impl StorageKeyEntry {
    pub fn new(
        namespace: Symbol,
        key: Symbol,
        tier: StorageTier,
        class: StateClass,
        field_count: u32,
    ) -> Self {
        Self {
            namespace,
            key,
            tier,
            class,
            field_count,
            packed: false,
        }
    }

    pub fn packed(mut self) -> Self {
        self.packed = true;
        self
    }
}

/// A rule violation found while auditing a layout.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuditFinding {
    DuplicateKey(Symbol, Symbol),
    CriticalStateNotPersistent(Symbol, Symbol),
    UnstablePackedLayout(Symbol, Symbol),
    EmptyNamespace(Symbol),
    EmptyKey(Symbol),
    TooManyFields(Symbol, Symbol, u32),
}

/// Result of auditing a declared storage layout.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct AuditReport {
    pub entries: AuditVec<StorageKeyEntry>,
    pub findings: AuditVec<AuditFinding>,
}

impl AuditReport {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a key declaration and records any immediate findings.
    pub fn register(&mut self, entry: StorageKeyEntry) {
        if entry.namespace == symbol_short!("") {
            self.findings
                .push(AuditFinding::EmptyNamespace(entry.key.clone()));
        }
        if entry.key == symbol_short!("") {
            self.findings
                .push(AuditFinding::EmptyKey(entry.namespace.clone()));
        }
        if entry.class == StateClass::Critical && entry.tier != StorageTier::Persistent {
            self.findings.push(AuditFinding::CriticalStateNotPersistent(
                entry.namespace.clone(),
                entry.key.clone(),
            ));
        }
        if entry.field_count > 16 {
            self.findings.push(AuditFinding::TooManyFields(
                entry.namespace.clone(),
                entry.key.clone(),
                entry.field_count,
            ));
        }
        if entry.packed && entry.field_count == 0 {
            self.findings.push(AuditFinding::UnstablePackedLayout(
                entry.namespace.clone(),
                entry.key.clone(),
            ));
        }

        for existing in &self.entries {
            if existing.namespace == entry.namespace && existing.key == entry.key {
                self.findings.push(AuditFinding::DuplicateKey(
                    entry.namespace.clone(),
                    entry.key.clone(),
                ));
            }
        }
        self.entries.push(entry);
    }

    /// Convenience helper that registers a key and returns its position.
    pub fn audit(&mut self, entry: StorageKeyEntry) -> usize {
        self.register(entry);
        self.entries.len() - 1
    }

    pub fn is_clean(&self) -> bool {
        self.findings.is_empty()
    }

    pub fn finding_count(&self) -> usize {
        self.findings.len()
    }

    /// Compares two reports by their declared key names, ignoring declaration
    /// order so append-only enum changes remain compatible.
    pub fn layout_compatible(&self, other: &AuditReport) -> bool {
        if self.entries.len() != other.entries.len() {
            return false;
        }
        self.entries.iter().all(|entry| {
            other.entries.iter().any(|candidate| {
                candidate.namespace == entry.namespace && candidate.key == entry.key
            })
        })
    }

    /// Converts the findings to a Soroban `Vec` for contract-side logging.
    pub fn soroban_findings(&self, env: &Env) -> soroban_sdk::Vec<AuditFinding> {
        let mut findings = soroban_sdk::Vec::new(env);
        for finding in &self.findings {
            findings.push_back(finding.clone());
        }
        findings
    }

    /// Converts the entries to a Soroban `Vec` for contract-side inspection.
    pub fn soroban_entries(&self, env: &Env) -> soroban_sdk::Vec<StorageKeyEntry> {
        let mut entries = soroban_sdk::Vec::new(env);
        for entry in &self.entries {
            entries.push_back(entry.clone());
        }
        entries
    }
}

/// Builds a report for the canonical StellarLend storage keys.
pub fn audit_stellarlend_layout() -> AuditReport {
    let mut report = AuditReport::new();

    report.register(StorageKeyEntry::new(
        symbol_short!("cross"),
        symbol_short!("positions"),
        StorageTier::Persistent,
        StateClass::Critical,
        4,
    ));
    report.register(StorageKeyEntry::new(
        symbol_short!("risk"),
        symbol_short!("config"),
        StorageTier::Persistent,
        StateClass::Critical,
        6,
    ));
    report.register(StorageKeyEntry::new(
        symbol_short!("oracle"),
        symbol_short!("price"),
        StorageTier::Persistent,
        StateClass::Configuration,
        3,
    ));
    report.register(
        StorageKeyEntry::new(
            symbol_short!("risk"),
            symbol_short!("packed"),
            StorageTier::Persistent,
            StateClass::Critical,
            5,
        )
        .packed(),
    );

    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::symbol_short;

    #[test]
    fn canonical_layout_is_clean() {
        let report = audit_stellarlend_layout();
        assert!(report.is_clean());
        assert_eq!(report.entries.len(), 4);
        assert_eq!(report.finding_count(), 0);
    }

    #[test]
    fn detects_duplicate_keys() {
        let mut report = AuditReport::new();
        let entry = StorageKeyEntry::new(
            symbol_short!("risk"),
            symbol_short!("config"),
            StorageTier::Persistent,
            StateClass::Configuration,
            2,
        );
        report.register(entry.clone());
        report.register(entry);
        assert_eq!(report.finding_count(), 1);
        assert_eq!(
            report.findings.first(),
            Some(&AuditFinding::DuplicateKey(
                symbol_short!("risk"),
                symbol_short!("config"),
            ))
        );
    }

    #[test]
    fn detects_critical_state_in_non_persistent_storage() {
        let mut report = AuditReport::new();
        report.register(StorageKeyEntry::new(
            symbol_short!("risk"),
            symbol_short!("admin"),
            StorageTier::Instance,
            StateClass::Critical,
            1,
        ));
        assert_eq!(
            report.findings.first(),
            Some(&AuditFinding::CriticalStateNotPersistent(
                symbol_short!("risk"),
                symbol_short!("admin"),
            ))
        );
    }

    #[test]
    fn detects_unstable_packed_layouts() {
        let mut report = AuditReport::new();
        report.register(
            StorageKeyEntry::new(
                symbol_short!("risk"),
                symbol_short!("packed"),
                StorageTier::Persistent,
                StateClass::Critical,
                0,
            )
            .packed(),
        );
        assert_eq!(
            report.findings.first(),
            Some(&AuditFinding::UnstablePackedLayout(
                symbol_short!("risk"),
                symbol_short!("packed"),
            ))
        );
    }

    #[test]
    fn layouts_are_compatible_regardless_of_declaration_order() {
        let first = audit_stellarlend_layout();
        let mut second = AuditReport::new();
        for entry in first.entries.iter().rev() {
            second.entries.push(entry.clone());
        }
        assert!(first.layout_compatible(&second));
    }

    #[test]
    fn exports_findings_to_soroban_vec() {
        let env = Env::default();
        let report = audit_stellarlend_layout();
        assert_eq!(report.soroban_findings(&env).len(), 0);
        assert_eq!(report.soroban_entries(&env).len(), 4);
    }
}
