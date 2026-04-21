interface BudgetBarProps {
  budgetUsed: number;
  maxBudgetUsd: number;
  turnCount: number;
  maxTurns: number;
}

function getBarColor(pct: number): string {
  if (pct < 0.7) return "#34C759";
  if (pct < 0.9) return "#F59E0B";
  return "#FF3B30";
}

export function BudgetBar({
  budgetUsed,
  maxBudgetUsd,
  turnCount,
  maxTurns,
}: BudgetBarProps) {
  const budgetPct = maxBudgetUsd > 0 ? Math.min(budgetUsed / maxBudgetUsd, 1) : 0;
  const turnPct = maxTurns > 0 ? Math.min(turnCount / maxTurns, 1) : 0;

  return (
    <div className="budget-bar">
      <div className="budget-row">
        <span className="budget-label">
          预算: ${budgetUsed.toFixed(2)} / ${maxBudgetUsd.toFixed(2)}
        </span>
        <div className="budget-track">
          <div
            className="budget-fill"
            style={{
              width: `${budgetPct * 100}%`,
              backgroundColor: getBarColor(budgetPct),
            }}
          />
        </div>
      </div>
      <div className="budget-row">
        <span className="budget-label">
          轮次: {turnCount} / {maxTurns}
        </span>
        <div className="budget-track">
          <div
            className="budget-fill"
            style={{
              width: `${turnPct * 100}%`,
              backgroundColor: getBarColor(turnPct),
            }}
          />
        </div>
      </div>
    </div>
  );
}
