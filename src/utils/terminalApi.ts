import { authenticatedFetch } from './api';

export interface TerminalSession {
  sessionId: string;
  projectPath: string;
  terminalName: string;
  createdAt: string;
  lastActivity: string;
  tmuxAlive: boolean;
}

export interface TerminalCapabilities {
  tmuxAvailable: boolean;
}

export const terminalApi = {
  capabilities: (): Promise<TerminalCapabilities> =>
    authenticatedFetch('/api/terminal/capabilities').then(r => r.json()),

  list: (projectPath?: string): Promise<TerminalSession[]> => {
    const params = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';
    return authenticatedFetch(`/api/terminal${params}`).then(r => r.json());
  },

  create: (projectPath: string, terminalName?: string): Promise<TerminalSession> =>
    authenticatedFetch('/api/terminal', {
      method: 'POST',
      body: JSON.stringify({ projectPath, terminalName }),
    }).then(r => r.json()),

  rename: (sessionId: string, terminalName: string): Promise<{ success: boolean }> =>
    authenticatedFetch(`/api/terminal/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ terminalName }),
    }).then(r => r.json()),

  delete: (sessionId: string): Promise<{ success: boolean }> =>
    authenticatedFetch(`/api/terminal/${sessionId}`, {
      method: 'DELETE',
    }).then(r => r.json()),
};
