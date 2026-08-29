"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import ProviderModelRow from "./ProviderModelRow";

export default function PassthroughModelsSection({ providerAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel }) {
  const notifyWarning = useNotificationStore((s) => s.warning);
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias,
    type: "llm",
  });

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();

    if (allModels.some((model) => model.id === modelId)) {
      notifyWarning("Model already exists for this provider.");
      return;
    }

    setAdding(true);
    try {
      await onAddCustomModel(modelId);
      setNewModel("");
    } catch (error) {
      console.error("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        OpenRouter supports any model. Add models and create aliases for quick access.
      </p>

      {/* Add new model */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="new-model-input" className="text-xs text-text-muted mb-1 block">Model ID (from OpenRouter)</label>
          <input
            id="new-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="anthropic/claude-3-opus"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
      </div>

      {/* Models list */}
      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ id, fullModel, alias, source }) => (
            <ProviderModelRow
              key={`${source}-${fullModel}`}
              modelId={id}
              fullModel={fullModel}
              copied={copied}
              onCopy={onCopy}
              onDelete={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

PassthroughModelsSection.propTypes = {
  providerAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
};