import { Check, FloppyDisk, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { createProject, updateProject } from "../../../lib/api/projects";
import type { ProjectInput } from "../../../types/project";
import { useWorkspace } from "../useWorkspace";

type SaveStatus = "idle" | "saving" | "done" | "error";

/**
 * "Save as project" action for the Market View's primary-actions row.
 * Assembles the current WorkspaceState into a ProjectInput (Section 4 of the
 * architecture spec). PUTs over activeProjectId when present — including a
 * project just added empty from the sidebar — so saving updates it in place;
 * otherwise POSTs a new one and lets the backend assign the id.
 */
export function SaveProjectButton() {
  const { state, dispatch } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(state.activeProjectName ?? "");
  const [status, setStatus] = useState<SaveStatus>("idle");

  const canSave = Boolean(state.ticker && state.graph) && name.trim().length > 0;

  async function handleSave() {
    if (!state.ticker || !state.graph || !name.trim()) return;
    setStatus("saving");
    try {
      const input: ProjectInput = {
        name: name.trim(),
        ticker: state.ticker,
        graphSnapshot: state.graph,
        selectedMarketIds: state.selectedMarketIds,
        suggestedMarkets: state.suggestedMarkets,
        evidence: state.evidence,
      };
      const project = state.activeProjectId
        ? await updateProject(state.activeProjectId, input)
        : await createProject(input);
      dispatch({ type: "PROJECT_SAVED", id: project.id, name: project.name });
      setStatus("done");
      setTimeout(() => {
        setStatus("idle");
        setOpen(false);
      }, 900);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-medium transition"
        style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
      >
        <FloppyDisk size={16} weight="bold" />
        {state.activeProjectId ? "Update project" : "Save as project"}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="absolute right-0 top-[calc(100%+8px)] z-30 w-72 rounded-[var(--radius-panel)] p-3 shadow-lg"
            style={{ background: "var(--surface-elevated)", border: "1px solid var(--border)" }}
          >
            <label
              htmlFor="save-project-name"
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-tertiary)" }}
            >
              Project name
            </label>
            <div className="flex items-center gap-2">
              <input
                id="save-project-name"
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSave) handleSave();
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder={state.ticker ? `${state.ticker} thesis` : "Name this project"}
                className="flex-1 rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm outline-none"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cancel"
                className="flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-control)]"
                style={{ color: "var(--text-tertiary)" }}
              >
                <X size={14} />
              </button>
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave || status === "saving"}
              className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-control)] py-1.5 text-sm font-medium transition disabled:opacity-50"
              style={{ background: "var(--accent)", color: "var(--accent-contrast)" }}
            >
              {status === "done" ? (
                <>
                  <Check size={14} weight="bold" /> Saved
                </>
              ) : status === "saving" ? (
                "Saving…"
              ) : (
                "Save"
              )}
            </button>
            {status === "error" && (
              <p className="mt-1.5 text-xs" style={{ color: "var(--status-negative)" }}>
                Couldn't save — try again.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
