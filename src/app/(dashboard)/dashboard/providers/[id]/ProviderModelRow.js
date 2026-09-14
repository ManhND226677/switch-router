import PropTypes from "prop-types";

/**
 * Shared row for Compatible / Passthrough custom model lists.
 * Keeps copy / test / delete actions consistent and accessible.
 */
export default function ProviderModelRow({
  modelId,
  fullModel,
  copied,
  onCopy,
  onDelete,
  onTest,
  testStatus,
  isTesting = false,
  deleteLabel = "Remove model",
}) {
  const borderColor =
    testStatus === "ok"
      ? "border-green-500/40"
      : testStatus === "error"
        ? "border-red-500/40"
        : "border-border";

  const iconColor =
    testStatus === "ok" ? "#22c55e" : testStatus === "error" ? "#ef4444" : undefined;

  const copyKey = `model-${modelId}`;
  const isCopied = copied === copyKey;
  const testLabel = isTesting ? "Testing model" : "Test model";
  const copyLabel = isCopied ? "Copied model id" : "Copy model id";

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <span
        className="material-symbols-outlined text-base text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
        aria-hidden="true"
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{modelId}</p>
        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">
            {fullModel}
          </code>
          <div className="relative group/btn">
            <button
              type="button"
              onClick={() => onCopy(fullModel, copyKey)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
              aria-label={copyLabel}
              title={isCopied ? "Copied!" : "Copy"}
            >
              <span className="material-symbols-outlined text-sm" aria-hidden="true">
                {isCopied ? "check" : "content_copy"}
              </span>
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-xs text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 group-focus-within/btn:opacity-100 transition-opacity">
              {isCopied ? "Copied!" : "Copy"}
            </span>
          </div>
          {onTest && (
            <div className="relative group/btn">
              <button
                type="button"
                onClick={onTest}
                disabled={isTesting}
                className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-colors disabled:opacity-60"
                aria-label={testLabel}
                title={isTesting ? "Testing..." : "Test"}
              >
                <span
                  className="material-symbols-outlined text-sm"
                  aria-hidden="true"
                  style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}
                >
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-xs text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 group-focus-within/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="p-1 hover:bg-red-50 dark:hover:bg-red-500/10 rounded text-red-500"
        title={deleteLabel}
        aria-label={deleteLabel}
      >
        <span className="material-symbols-outlined text-sm" aria-hidden="true">
          delete
        </span>
      </button>
    </div>
  );
}

ProviderModelRow.propTypes = {
  modelId: PropTypes.string.isRequired,
  fullModel: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onTest: PropTypes.func,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isTesting: PropTypes.bool,
  deleteLabel: PropTypes.string,
};
