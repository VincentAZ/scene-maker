import {
  thinkingChoices,
  thinkingLabels,
  type ThinkingLevel,
} from "../shared/thinking";
export function ThinkingControl({
  provider,
  model,
  value,
  disabled,
  onChange,
}: {
  provider: string | null;
  model: string;
  value: ThinkingLevel;
  disabled?: boolean;
  onChange: (value: ThinkingLevel) => void;
}) {
  const choices = thinkingChoices(provider, model);
  return (
    <label className="thinking-control">
      Thinking effort
      <select
        aria-label="Thinking effort"
        value={choices.includes(value) ? value : "default"}
        disabled={disabled || choices.length === 1}
        onChange={(e) => onChange(e.target.value as ThinkingLevel)}
      >
        {choices.map((level) => (
          <option key={level} value={level}>
            {thinkingLabels[level]}
          </option>
        ))}
      </select>
      <small>
        {choices.length === 1
          ? "This model uses its default thinking settings."
          : "Higher effort can take longer and use more tokens."}
      </small>
    </label>
  );
}
