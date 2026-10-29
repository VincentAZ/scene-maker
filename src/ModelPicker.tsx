import { useState } from "react";
import { Check } from "lucide-react";
import {
  advancedModelGroup,
  modelDisplayName,
  studioModelChoices,
  type Provider,
  type ProviderModel,
} from "../shared/modelChoices";

export function ModelPicker({
  provider,
  models,
  value,
  disabled,
  onChange,
}: {
  provider: Provider;
  models: ProviderModel[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("All models");
  const choices = studioModelChoices(provider, models);
  const current = models.find((model) => model.id === value);
  const advancedCurrent =
    current && !choices.some((choice) => choice.id === value);
  const groups = [
    "All models",
    "Other models",
    "Version snapshots",
    "Fine-tuned models",
  ];
  const matches = models.filter(
    (model) =>
      (group === "All models" || advancedModelGroup(model.id) === group) &&
      `${model.name} ${model.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="model-picker">
      <fieldset className="model-choices" disabled={disabled}>
        <legend>2. Choose how your assistant works</legend>
        <p className="model-picker-intro">
          {choices.length
            ? "Start with a studio suggestion. You can change it anytime."
            : "No studio suggestions match this account yet. Choose a model in Advanced models."}
        </p>
        {choices.map((choice) => (
          <label
            className={`model-choice ${value === choice.id ? "selected" : ""}`}
            key={choice.id}
          >
            <input
              type="radio"
              name={`${provider}-studio-model`}
              value={choice.id}
              checked={value === choice.id}
              onChange={() => onChange(choice.id)}
            />
            <span className="model-choice-content">
              <span className="model-choice-heading">
                <strong>{choice.title}</strong>
                {choice.recommended && (
                  <span className="model-recommended">Recommended</span>
                )}
              </span>
              <span className="model-choice-name">{choice.name}</span>
              <span className="model-choice-description">
                {choice.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {advancedCurrent && (
        <div className="model-current" role="status">
          <Check size={14} />
          <span>
            Selected: <strong>{modelDisplayName(current)}</strong> · Advanced
            model
          </span>
        </div>
      )}
      <details className="model-advanced">
        <summary>
          Advanced models <span>{models.length} available</span>
        </summary>
        <p className="small">
          All returned identifiers, including older releases, snapshots, and
          fine-tunes.
        </p>
        <label>
          Search all models
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or identifier"
          />
        </label>
        <label>
          Show
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            {groups.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <div
          className="advanced-model-results"
          role="group"
          aria-label="Advanced model results"
        >
          {matches.slice(0, 50).map((model) => (
            <button
              type="button"
              key={model.id}
              aria-pressed={value === model.id}
              disabled={disabled}
              onClick={() => onChange(model.id)}
            >
              <span>
                <strong>{modelDisplayName(model)}</strong>
                <code>{model.id}</code>
              </span>
              {value === model.id && <Check size={15} />}
            </button>
          ))}
          {!matches.length && (
            <p role="status">No models match. Try another search or filter.</p>
          )}
        </div>
        <p className="small" role="status">
          {matches.length > 50
            ? `Showing 50 of ${matches.length} matches. Search to narrow the list.`
            : `${matches.length} matching models.`}
        </p>
        {current && (
          <p className="model-identifier">
            Selected identifier: <code>{current.id}</code>
          </p>
        )}
      </details>
    </div>
  );
}
