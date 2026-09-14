"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/components/Modal";
import Input from "@/shared/components/Input";
import Button from "@/shared/components/Button";
import Badge from "@/shared/components/Badge";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS } from "@/shared/constants/providers";
import Select from "@/shared/components/Select";
import { fetchWithTimeout } from "@/shared/utils/fetchWithTimeout";

export default function EditConnectionModal({ isOpen, connection, proxyPools, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    priority: 1,
    apiKey: "",
  });
  const [baseUrl, setBaseUrl] = useState("");
  const [region, setRegion] = useState("");
  const [endpointProfile, setEndpointProfile] = useState("default");
  const [apiMode, setApiMode] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const providerApiModes = connection ? (AI_PROVIDERS?.[connection.provider]?.apiModes || []) : [];
  const defaultApiMode = connection
    ? (AI_PROVIDERS?.[connection.provider]?.defaultApiMode || providerApiModes[0]?.id || "")
    : "";

  /* eslint-disable react-hooks/set-state-in-effect -- sync connection form when the selected connection changes. */
  useEffect(() => {
    if (connection) {
      setFormData({
        name: connection.name || "",
        priority: connection.priority || 1,
        apiKey: "",
      });
      setBaseUrl(connection.providerSpecificData?.baseUrl || "");
      // Load region for providers that support it (e.g. xiaomi-tokenplan)
      const providerCfg = AI_PROVIDERS?.[connection.provider];
      if (providerCfg?.regions) {
        const savedRegion = connection.providerSpecificData?.region || providerCfg.defaultRegion || providerCfg.regions[0]?.id || "";
        setRegion(savedRegion);
      }
      setApiMode(connection.providerSpecificData?.apiMode || defaultApiMode);
      setTestResult(null);
      setValidationResult(null);
    }
  }, [connection, defaultApiMode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const isOAuth = connection?.authType === "oauth";
  const isCompatible = connection
    ? (isOpenAICompatibleProvider(connection.provider) || isAnthropicCompatibleProvider(connection.provider))
    : false;
  const isPerKeyBaseUrlProvider = connection?.provider === "vilao";
  const providerRegions = connection ? (AI_PROVIDERS?.[connection.provider]?.regions || null) : null;

  // Build providerSpecificData for region-aware providers
  const buildRegionSpecificData = () => {
    if (providerRegions && region) return { ...((connection?.providerSpecificData) || {}), region };
    return undefined;
  };

  const buildBaseUrlSpecificData = () => {
    if (!isPerKeyBaseUrlProvider || !baseUrl.trim()) return undefined;
    return {
      ...((connection?.providerSpecificData) || {}),
      baseUrl: baseUrl.trim(),
    };
  };

  const buildApiModeSpecificData = () => {
    if (providerApiModes.length === 0 || !apiMode) return undefined;
    return {
      ...((connection?.providerSpecificData) || {}),
      apiMode,
    };
  };

  const handleTest = async () => {
    if (!connection?.provider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetchWithTimeout(`/api/providers/${connection.id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult(data.valid ? "success" : "failed");
    } catch {
      setTestResult("failed");
    } finally {
      setTesting(false);
    }
  };

  const handleValidate = async () => {
    if (!connection?.provider || !formData.apiKey) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const res = await fetchWithTimeout("/api/providers/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: connection.provider,
          apiKey: formData.apiKey,
          ...(isPerKeyBaseUrlProvider ? { providerSpecificData: buildBaseUrlSpecificData() } : {}),
          ...(providerRegions ? { providerSpecificData: buildRegionSpecificData() } : {}),
          ...(providerApiModes.length > 0 ? { providerSpecificData: buildApiModeSpecificData() } : {}),
        }),
      });
      const data = await res.json();
      setValidationResult(data.valid ? "success" : "failed");
    } catch {
      setValidationResult("failed");
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async () => {
    if (!connection) return;
    setSaving(true);
    try {
      const updates = {
        name: formData.name,
        priority: formData.priority,
      };
      if (!isOAuth && formData.apiKey) {
        updates.apiKey = formData.apiKey;
        let isValid = validationResult === "success";
        if (!isValid) {
          try {
            setValidating(true);
            setValidationResult(null);
            const res = await fetchWithTimeout("/api/providers/validate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: connection.provider,
                apiKey: formData.apiKey,
                ...(isPerKeyBaseUrlProvider ? { providerSpecificData: buildBaseUrlSpecificData() } : {}),
                ...(providerRegions ? { providerSpecificData: buildRegionSpecificData() } : {}),
                ...(providerApiModes.length > 0 ? { providerSpecificData: buildApiModeSpecificData() } : {}),
              }),
            });
            const data = await res.json();
            isValid = !!data.valid;
            setValidationResult(isValid ? "success" : "failed");
          } catch {
            setValidationResult("failed");
          } finally {
            setValidating(false);
          }
        }
        if (isValid) {
          updates.testStatus = "active";
          updates.lastError = null;
          updates.lastErrorAt = null;
        }
      }
      
      // Persist updated per-key baseUrl (ViLao P2P gateway)
      if (isPerKeyBaseUrlProvider) {
        updates.providerSpecificData = buildBaseUrlSpecificData();
      }
      // Persist updated region for region-aware providers
      if (providerRegions && region) {
        updates.providerSpecificData = buildRegionSpecificData();
      }
      if (providerApiModes.length > 0) {
        updates.providerSpecificData = buildApiModeSpecificData();
      }
      
      await onSave(updates);
    } finally {
      setSaving(false);
    }
  };

  if (!connection) return null;

  return (
    <Modal isOpen={isOpen} title="Edit Connection" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={isOAuth ? "Account name" : "Production Key"}
        />
        {isOAuth && connection.email && (
          <div className="bg-sidebar/50 p-3 rounded-lg">
            <p className="text-sm text-text-muted mb-1">Email</p>
            <p className="font-medium">{connection.email}</p>
          </div>
        )}
        <Input
          label="Priority"
          type="number"
          value={formData.priority}
          onChange={(e) => setFormData({ ...formData, priority: Number.parseInt(e.target.value, 10) || 1 })}
        />

        {isPerKeyBaseUrlProvider && (
          <Input
            label="Base URL"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.vilao.ai/v1"
            hint="Your ViLao gateway endpoint. Leave blank to keep the current value."
          />
        )}

        {!isOAuth && (
          <>
            <div className="flex gap-2">
              <Input
                label="API Key"
                type="password"
                value={formData.apiKey}
                onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder="Enter new API key"
                hint="Leave blank to keep the current API key."
                className="flex-1"
              />
              <div className="pt-6">
                <Button onClick={handleValidate} disabled={!formData.apiKey || validating || saving} variant="secondary">
                  {validating ? "Checking..." : "Check"}
                </Button>
              </div>
            </div>
            {validationResult && (
              <Badge variant={validationResult === "success" ? "success" : "error"}>
                {validationResult === "success" ? "Valid" : "Invalid"}
              </Badge>
            )}
          </>
        )}

        {providerRegions && (
          <Select
            label="Region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            options={providerRegions.map((r) => ({ value: r.id, label: r.label }))}
          />
        )}

        {providerApiModes.length > 0 && (
          <Select
            label="API Plan"
            value={apiMode}
            onChange={(e) => setApiMode(e.target.value)}
            options={providerApiModes.map((modeOption) => ({ value: modeOption.id, label: modeOption.label }))}
          />
        )}

        {!isCompatible && (
          <div className="flex items-center gap-3">
            <Button onClick={handleTest} variant="secondary" disabled={testing}>
              {testing ? "Testing..." : "Test Connection"}
            </Button>
            {testResult && (
              <Badge variant={testResult === "success" ? "success" : "error"}>
                {testResult === "success" ? "Valid" : "Failed"}
              </Badge>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleSubmit} fullWidth disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

EditConnectionModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    priority: PropTypes.number,
    authType: PropTypes.string,
    provider: PropTypes.string,
    providerSpecificData: PropTypes.object,
  }),
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
  })),
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
