export function ListLimitToggle({
  total,
  shown,
  expanded,
  onToggle,
  unitLabel = 'ခု',
}: {
  total: number;
  shown: number;
  expanded: boolean;
  onToggle: () => void;
  unitLabel?: string;
}) {
  if (total <= shown && !expanded) return null;
  return (
    <div className="list-limit-footer">
      <span className="list-limit-count">
        {expanded
          ? `${total.toLocaleString()} ${unitLabel} အားလုံးပြထားသည်`
          : `${shown.toLocaleString()} / ${total.toLocaleString()} ${unitLabel} ပြထားသည်`}
      </span>
      <button type="button" className="button button-outline list-limit-btn" onClick={onToggle}>
        {expanded ? 'အတိုချုံးပြရန်' : `အားလုံးပြရန် (${total.toLocaleString()})`}
      </button>
    </div>
  );
}
