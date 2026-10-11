import type { Project } from "../../../types/project";

/** Rough "2h ago" formatting — this is a quick-recall list, not a detail view, so precision doesn't matter. */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

interface ProjectTabProps {
  project: Project;
  active: boolean;
  expanded: boolean;
  onSelect: () => void;
}

/**
 * One saved-project row. `expanded` controls whether the name/ticker/timestamp
 * are visible or the tab is collapsed to just a glyph — driven by the rail's
 * hover-preview/pin state in ProjectSidebar, not anything local to this component.
 */
export function ProjectTab({ project, active, expanded, onSelect }: ProjectTabProps) {
  const glyph = (project.ticker ?? project.name).slice(0, 2);
  const subtitle = project.ticker
    ? `${project.ticker} · saved ${relativeTime(project.updatedAt)}`
    : `No ticker yet · added ${relativeTime(project.createdAt)}`;

  return (
    <button
      type="button"
      onClick={onSelect}
      title={project.ticker ? `${project.name} (${project.ticker})` : project.name}
      className="flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-left transition"
      style={{
        background: active ? "var(--accent)" : "transparent",
        color: active ? "var(--accent-contrast)" : "var(--text-primary)",
      }}
    >
      <span
        className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10px] font-semibold uppercase"
        style={{
          background: active ? "var(--accent-contrast)" : "var(--surface-elevated)",
          color: active ? "var(--accent)" : "var(--text-secondary)",
          border: active ? "none" : "1px solid var(--border)",
        }}
      >
        {glyph}
      </span>
      {expanded && (
        <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <span className="truncate text-sm font-medium leading-tight">{project.name}</span>
          <span
            className="truncate text-xs leading-tight"
            style={{ color: active ? "var(--accent-contrast)" : "var(--text-tertiary)", opacity: active ? 0.85 : 1 }}
          >
            {subtitle}
          </span>
        </span>
      )}
    </button>
  );
}
