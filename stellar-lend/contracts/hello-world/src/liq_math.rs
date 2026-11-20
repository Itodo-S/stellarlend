use stellarlend_math::checked::apply_bps;
use stellarlend_math::liquidation::{
    dynamic_penalty_bps as math_dynamic_penalty_bps, health_factor_bps as math_health_factor_bps,
    seize_amount as math_seize_amount,
};
use stellarlend_math::MathError;

pub use stellarlend_math::liquidation::MAX_PENALTY_BPS;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct LiquidationEconomics {
    pub min_collateral_ratio_bps: i128,
    pub liquidation_threshold_bps: i128,
    pub close_factor_bps: i128,
    pub liquidation_incentive_bps: i128,
}

impl LiquidationEconomics {
    pub const fn new(
        min_collateral_ratio_bps: i128,
        liquidation_threshold_bps: i128,
        close_factor_bps: i128,
        liquidation_incentive_bps: i128,
    ) -> Self {
        Self {
            min_collateral_ratio_bps,
            liquidation_threshold_bps,
            close_factor_bps,
            liquidation_incentive_bps,
        }
    }

    pub fn health_factor_bps(
        &self,
        collateral_value: i128,
        debt_value: i128,
    ) -> Result<i128, MathError> {
        health_factor_bps(collateral_value, debt_value)
    }

    pub fn is_liquidatable(
        &self,
        collateral_value: i128,
        debt_value: i128,
    ) -> Result<bool, MathError> {
        is_liquidatable(collateral_value, debt_value, self.liquidation_threshold_bps)
    }

    pub fn meets_min_collateral_ratio(
        &self,
        collateral_value: i128,
        debt_value: i128,
    ) -> Result<bool, MathError> {
        meets_min_collateral_ratio(collateral_value, debt_value, self.min_collateral_ratio_bps)
    }

    pub fn max_liquidatable(&self, debt_value: i128) -> Result<i128, MathError> {
        max_liquidatable(debt_value, self.close_factor_bps)
    }

    pub fn incentive_amount(&self, liquidated_amount: i128) -> Result<i128, MathError> {
        incentive_amount(liquidated_amount, self.liquidation_incentive_bps)
    }

    pub fn dynamic_penalty_bps(
        &self,
        collateral_value: i128,
        total_debt: i128,
    ) -> Result<i128, MathError> {
        dynamic_penalty_bps(
            collateral_value,
            total_debt,
            self.liquidation_incentive_bps,
            self.liquidation_threshold_bps,
        )
    }

    pub fn seize_amount(&self, collateral_equivalent: i128) -> Result<i128, MathError> {
        seize_amount(collateral_equivalent, self.liquidation_incentive_bps)
    }

    pub fn bad_debt_amount(
        &self,
        collateral_value: i128,
        debt_value: i128,
    ) -> Result<i128, MathError> {
        bad_debt_amount(collateral_value, debt_value, self.liquidation_threshold_bps)
    }
}

pub fn health_factor_bps(collateral_value: i128, debt_value: i128) -> Result<i128, MathError> {
    if debt_value == 0 {
        Ok(i128::MAX)
    } else {
        math_health_factor_bps(collateral_value, debt_value)
    }
}

pub fn is_liquidatable(
    collateral_value: i128,
    debt_value: i128,
    threshold_bps: i128,
) -> Result<bool, MathError> {
    Ok(health_factor_bps(collateral_value, debt_value)? < threshold_bps)
}

pub fn meets_min_collateral_ratio(
    collateral_value: i128,
    debt_value: i128,
    min_collateral_ratio_bps: i128,
) -> Result<bool, MathError> {
    Ok(health_factor_bps(collateral_value, debt_value)? >= min_collateral_ratio_bps)
}

pub fn max_liquidatable(debt_value: i128, close_factor_bps: i128) -> Result<i128, MathError> {
    apply_bps(debt_value, close_factor_bps)
}

pub fn incentive_amount(liquidated_amount: i128, incentive_bps: i128) -> Result<i128, MathError> {
    apply_bps(liquidated_amount, incentive_bps)
}

pub fn dynamic_penalty_bps(
    collateral_value: i128,
    total_debt: i128,
    base_incentive_bps: i128,
    threshold_bps: i128,
) -> Result<i128, MathError> {
    math_dynamic_penalty_bps(
        collateral_value,
        total_debt,
        base_incentive_bps,
        threshold_bps,
    )
}

pub fn seize_amount(collateral_equivalent: i128, incentive_bps: i128) -> Result<i128, MathError> {
    math_seize_amount(collateral_equivalent, incentive_bps)
}

pub fn bad_debt_amount(
    collateral_value: i128,
    debt_value: i128,
    threshold_bps: i128,
) -> Result<i128, MathError> {
    let covered = apply_bps(collateral_value, threshold_bps)?;
    Ok(debt_value.saturating_sub(covered).max(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_factor_uses_max_for_debt_free_positions() {
        assert_eq!(health_factor_bps(500, 0).unwrap(), i128::MAX);
        assert_eq!(health_factor_bps(1_100, 1_000).unwrap(), 11_000);
    }

    #[test]
    fn liquidatable_requires_ratio_below_threshold() {
        assert!(!is_liquidatable(1_050, 1_000, 10_500).unwrap());
        assert!(is_liquidatable(1_049, 1_000, 10_500).unwrap());
        assert!(!is_liquidatable(500, 0, 10_500).unwrap());
    }

    #[test]
    fn minimum_collateral_ratio_is_satisfied_at_boundary() {
        assert!(meets_min_collateral_ratio(1_100, 1_000, 11_000).unwrap());
        assert!(!meets_min_collateral_ratio(1_099, 1_000, 11_000).unwrap());
        assert!(meets_min_collateral_ratio(0, 0, 11_000).unwrap());
    }

    #[test]
    fn max_liquidatable_uses_close_factor() {
        assert_eq!(max_liquidatable(1_000, 5_000).unwrap(), 500);
        assert_eq!(max_liquidatable(0, 5_000).unwrap(), 0);
    }

    #[test]
    fn incentive_amount_is_bonus_only() {
        assert_eq!(incentive_amount(1_000, 1_000).unwrap(), 100);
        assert_eq!(incentive_amount(1_000, 0).unwrap(), 0);
    }

    #[test]
    fn dynamic_penalty_scales_and_caps() {
        let economics = LiquidationEconomics::new(11_000, 10_500, 5_000, 1_000);
        assert_eq!(economics.dynamic_penalty_bps(1_200, 1_000).unwrap(), 1_000);
        assert!(economics.dynamic_penalty_bps(900, 1_000).unwrap() > 1_000);
        assert_eq!(
            economics.dynamic_penalty_bps(0, 1_000).unwrap(),
            MAX_PENALTY_BPS
        );
        assert_eq!(economics.dynamic_penalty_bps(500, 0).unwrap(), 1_000);
    }

    #[test]
    fn seize_amount_includes_incentive() {
        assert_eq!(seize_amount(1_000, 1_000).unwrap(), 1_100);
    }

    #[test]
    fn bad_debt_is_only_the_uncovered_shortfall() {
        assert_eq!(bad_debt_amount(1_000, 1_000, 8_000).unwrap(), 200);
        assert_eq!(bad_debt_amount(1_250, 1_000, 8_000).unwrap(), 0);
    }

    #[test]
    fn economics_methods_match_free_functions() {
        let economics = LiquidationEconomics::new(11_000, 10_500, 5_000, 1_000);
        assert_eq!(
            economics.health_factor_bps(1_100, 1_000).unwrap(),
            health_factor_bps(1_100, 1_000).unwrap()
        );
        assert_eq!(
            economics.is_liquidatable(1_000, 1_000).unwrap(),
            is_liquidatable(1_000, 1_000, 10_500).unwrap()
        );
        assert_eq!(
            economics.meets_min_collateral_ratio(1_100, 1_000).unwrap(),
            meets_min_collateral_ratio(1_100, 1_000, 11_000).unwrap()
        );
        assert_eq!(
            economics.max_liquidatable(1_000).unwrap(),
            max_liquidatable(1_000, 5_000).unwrap()
        );
        assert_eq!(
            economics.incentive_amount(1_000).unwrap(),
            incentive_amount(1_000, 1_000).unwrap()
        );
        assert_eq!(
            economics.seize_amount(1_000).unwrap(),
            seize_amount(1_000, 1_000).unwrap()
        );
        assert_eq!(
            economics.bad_debt_amount(1_000, 1_000).unwrap(),
            bad_debt_amount(1_000, 1_000, 10_500).unwrap()
        );
    }
}
