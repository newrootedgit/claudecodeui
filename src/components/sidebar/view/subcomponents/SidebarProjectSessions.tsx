import { ChevronDown, Plus, Terminal } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../../shared/view/ui';
import type { Project, ProjectSession, SessionProvider } from '../../../../types/app';
import type { TerminalSession } from '../../../../utils/terminalApi';
import type { SessionWithProvider } from '../../types/types';
import SidebarSessionItem from './SidebarSessionItem';
import SidebarTerminalItem from './SidebarTerminalItem';

type SidebarProjectSessionsProps = {
  project: Project;
  isExpanded: boolean;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project) => void;
  terminalSessions: TerminalSession[];
  selectedTerminalSessionId: string | null;
  editingTerminal: string | null;
  editingTerminalName: string;
  onEditingTerminalNameChange: (value: string) => void;
  onStartEditingTerminal: (sessionId: string, currentName: string) => void;
  onCancelEditingTerminal: () => void;
  onSaveEditingTerminal: (sessionId: string, newName: string) => void;
  onTerminalSelect: (terminal: TerminalSession) => void;
  onTerminalDelete: (sessionId: string) => void;
  onNewTerminal: (project: Project) => void;
  t: TFunction;
};

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-md p-2">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 h-3 w-3 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${60 + index * 15}%` }} />
              <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function SidebarProjectSessions({
  project,
  isExpanded,
  sessions,
  selectedSession,
  initialSessionsLoaded,
  isLoadingSessions,
  currentTime,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  terminalSessions,
  selectedTerminalSessionId,
  editingTerminal,
  editingTerminalName,
  onEditingTerminalNameChange,
  onStartEditingTerminal,
  onCancelEditingTerminal,
  onSaveEditingTerminal,
  onTerminalSelect,
  onTerminalDelete,
  onNewTerminal,
  t,
}: SidebarProjectSessionsProps) {
  if (!isExpanded) {
    return null;
  }

  const hasSessions = sessions.length > 0;
  const hasMoreSessions = project.sessionMeta?.hasMore === true;

  return (
    <div className="ml-3 space-y-1 border-l border-border pl-3">
      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasSessions && !isLoadingSessions ? (
        <div className="px-3 py-2 text-left">
          <p className="text-xs text-muted-foreground">{t('sessions.noSessions')}</p>
        </div>
      ) : (
        sessions.map((session) => (
          <SidebarSessionItem
            key={session.id}
            project={project}
            session={session}
            selectedSession={selectedSession}
            currentTime={currentTime}
            editingSession={editingSession}
            editingSessionName={editingSessionName}
            onEditingSessionNameChange={onEditingSessionNameChange}
            onStartEditingSession={onStartEditingSession}
            onCancelEditingSession={onCancelEditingSession}
            onSaveEditingSession={onSaveEditingSession}
            onProjectSelect={onProjectSelect}
            onSessionSelect={onSessionSelect}
            onDeleteSession={onDeleteSession}
            t={t}
          />
        ))
      )}

      {hasSessions && hasMoreSessions && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 w-full justify-center gap-2 text-muted-foreground"
          onClick={() => onLoadMoreSessions(project)}
          disabled={isLoadingSessions}
        >
          {isLoadingSessions ? (
            <>
              <div className="h-3 w-3 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
              {t('sessions.loading')}
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              {t('sessions.showMore')}
            </>
          )}
        </Button>
      )}

      <div className="px-3 pb-2 md:hidden">
        <button
          className="flex h-8 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
          onClick={() => {
            onProjectSelect(project);
            onNewSession(project);
          }}
        >
          <Plus className="h-3 w-3" />
          {t('sessions.newSession')}
        </button>
      </div>

      <Button
        variant="default"
        size="sm"
        className="mt-1 hidden h-8 w-full justify-start gap-2 bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 md:flex"
        onClick={() => onNewSession(project)}
      >
        <Plus className="h-3 w-3" />
        {t('sessions.newSession')}
      </Button>

      {/* Terminal Sessions Section */}
      <div className="mt-3 border-t border-border/50 pt-2">
        <div className="mb-1 flex items-center gap-1 px-1">
          <Terminal className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Terminals</span>
        </div>

        {terminalSessions.length === 0 ? (
          <div className="px-3 py-1">
            <p className="text-xs text-muted-foreground">No terminal sessions</p>
          </div>
        ) : (
          terminalSessions.map((terminal) => (
            <SidebarTerminalItem
              key={terminal.sessionId}
              terminal={terminal}
              isSelected={selectedTerminalSessionId === terminal.sessionId}
              isEditing={editingTerminal === terminal.sessionId}
              editingName={editingTerminalName}
              onEditingNameChange={onEditingTerminalNameChange}
              onStartEditing={onStartEditingTerminal}
              onCancelEditing={onCancelEditingTerminal}
              onSaveEditing={onSaveEditingTerminal}
              onSelect={onTerminalSelect}
              onDelete={onTerminalDelete}
            />
          ))
        )}

        <Button
          variant="outline"
          size="sm"
          className="mt-1 hidden h-7 w-full justify-start gap-2 border-dashed text-xs text-muted-foreground transition-colors hover:text-foreground md:flex"
          onClick={() => onNewTerminal(project)}
        >
          <Plus className="h-3 w-3" />
          New Terminal
        </Button>

        <div className="px-3 pb-2 md:hidden">
          <button
            className="flex h-7 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border text-xs font-medium text-muted-foreground transition-all duration-150 hover:text-foreground active:scale-[0.98]"
            onClick={() => onNewTerminal(project)}
          >
            <Plus className="h-3 w-3" />
            New Terminal
          </button>
        </div>
      </div>
    </div>
  );
}
