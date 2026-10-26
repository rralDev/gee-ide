import * as vscode from 'vscode';

export interface GEETask {
    id: string;
    description?: string;
    state: string; // 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'CANCEL_REQUESTED'
    task_type?: string;
    error_message?: string;
    update_timestamp_ms?: number;
    start_timestamp_ms?: number;
    creation_timestamp_ms?: number;
}

/**
 * TaskNotifier
 * Modular background observer for Google Earth Engine export tasks.
 * Polyglot: monitors Earth Engine task backend across JS, Python, and R workflows.
 */
export class TaskNotifier implements vscode.Disposable {
    private previousTaskStates: Map<string, string> = new Map();
    private sessionTasks: Set<string> = new Set();
    private notifiedTasks: Set<string> = new Set();
    private isInitialized: boolean = false;
    private timer: NodeJS.Timeout | undefined;
    private burstTimers: NodeJS.Timeout[] = [];
    private isPolling: boolean = false;
    private getTasksFn: (() => Promise<GEETask[]>) | undefined;
    private onTasksUpdatedCallback: ((tasks: GEETask[]) => void) | undefined;
    private pollingIntervalMs: number = 10000;

    constructor() {}

    public start(getTasksFn: () => Promise<GEETask[]>, onTasksUpdated?: (tasks: GEETask[]) => void) {
        this.getTasksFn = getTasksFn;
        this.onTasksUpdatedCallback = onTasksUpdated;
        this.stop();
        this.pollOnce().catch(() => {});
        this.scheduleNextPoll();
    }

    public stop() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        for (const bt of this.burstTimers) {
            clearTimeout(bt);
        }
        this.burstTimers = [];
    }

    /**
     * Explicitly registers a task description/id started during this session
     */
    public trackTask(descriptionOrId?: string) {
        if (descriptionOrId) {
            this.sessionTasks.add(descriptionOrId.trim());
        }
    }

    /**
     * Wakes up faster polling (e.g. immediately when an export task is triggered in JS, Python or R).
     * Schedules a burst of rapid checks (1.2s, 3s, 6s) to catch Earth Engine cloud registration.
     */
    public wakeUp(descriptionOrId?: string) {
        if (descriptionOrId) {
            this.trackTask(descriptionOrId);
        }
        this.pollingIntervalMs = 5000;

        // Clear existing burst timers
        for (const bt of this.burstTimers) {
            clearTimeout(bt);
        }
        this.burstTimers = [];

        // Schedule burst of rapid checks
        const bursts = [1200, 3000, 6000];
        bursts.forEach(delay => {
            const t = setTimeout(() => {
                this.pollOnce().catch(() => {});
            }, delay);
            this.burstTimers.push(t);
        });

        this.scheduleNextPoll();
    }

    /**
     * Feed externally retrieved tasks (e.g. from manual Refresh click in Tasks UI)
     */
    public feedTasks(rawTasks: any) {
        const tasks = this.extractTasksArray(rawTasks);
        this.processTaskDeltas(tasks);
    }

    public dispose() {
        this.stop();
        this.previousTaskStates.clear();
        this.sessionTasks.clear();
        this.notifiedTasks.clear();
    }

    private scheduleNextPoll() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(async () => {
            await this.pollOnce();
            this.scheduleNextPoll();
        }, this.pollingIntervalMs);
    }

    private extractTasksArray(raw: any): GEETask[] {
        if (Array.isArray(raw)) {
            return raw;
        }
        if (raw && Array.isArray(raw.tasks)) {
            return raw.tasks;
        }
        return [];
    }

    public async pollOnce() {
        if (this.isPolling || !this.getTasksFn) return;
        this.isPolling = true;
        try {
            const rawTasks = await this.getTasksFn();
            const tasks = this.extractTasksArray(rawTasks);

            this.processTaskDeltas(tasks);

            if (this.onTasksUpdatedCallback) {
                this.onTasksUpdatedCallback(tasks);
            }

            // Adaptive polling frequency based on activity
            const hasActive = tasks.some(t => t && (t.state === 'RUNNING' || t.state === 'READY'));
            if (hasActive) {
                this.pollingIntervalMs = 5000; // Poll every 5s while tasks are in progress
            } else {
                this.pollingIntervalMs = 30000; // 30s when idle
            }
        } catch (err) {
            // Silently ignore temporary network glitches during background polling
        } finally {
            this.isPolling = false;
        }
    }

    private processTaskDeltas(tasks: GEETask[]) {
        if (!Array.isArray(tasks)) return;

        // On initial startup, record all existing task states so we never spam notifications for historical tasks
        if (!this.isInitialized) {
            for (const task of tasks) {
                if (task && task.id) {
                    this.previousTaskStates.set(task.id, task.state);
                    if (task.state === 'COMPLETED' || task.state === 'FAILED' || task.state === 'CANCELLED') {
                        this.notifiedTasks.add(task.id);
                    }
                }
            }
            this.isInitialized = true;
            return;
        }

        for (const task of tasks) {
            if (!task || !task.id) continue;
            const id = task.id;
            const desc = task.description || id;
            const currentState = task.state;
            const prevState = this.previousTaskStates.get(id);

            // If task is running or ready, remember it was active in this session
            if (currentState === 'RUNNING' || currentState === 'READY') {
                this.sessionTasks.add(id);
                if (task.description) this.sessionTasks.add(task.description);
            }

            if (!this.notifiedTasks.has(id)) {
                const wasActiveBefore = prevState === 'RUNNING' || prevState === 'READY';
                const isSessionInitiated = this.sessionTasks.has(id) || (task.description && this.sessionTasks.has(task.description));

                if (wasActiveBefore || isSessionInitiated) {
                    if (currentState === 'COMPLETED') {
                        this.notifiedTasks.add(id);
                        this.notifySuccess(desc);
                    } else if (currentState === 'FAILED') {
                        this.notifiedTasks.add(id);
                        this.notifyFailure(desc, task.error_message);
                    }
                }
            }

            this.previousTaskStates.set(id, currentState);
        }
    }

    private notifySuccess(description: string) {
        vscode.window.showInformationMessage(
            `✅ GEE Task '${description}' completada exitosamente!`,
            'Abrir en Google Drive'
        ).then(action => {
            if (action === 'Abrir en Google Drive') {
                const query = encodeURIComponent(description);
                vscode.env.openExternal(vscode.Uri.parse(`https://drive.google.com/drive/u/0/search?q=${query}`));
            }
        });
    }

    private notifyFailure(description: string, rawError?: string) {
        const errorText = rawError || 'Error desconocido';
        let tip = '';
        const lower = errorText.toLowerCase();
        if (lower.includes('memory') || lower.includes('user memory limit exceeded')) {
            tip = " 💡 Tip: Incrementa 'tileScale: 4' o reduce maxPixels / región.";
        } else if (lower.includes('timeout') || lower.includes('timed out')) {
            tip = " 💡 Tip: Se excedió el tiempo límite. Incrementa la escala o exporta por regiones más pequeñas.";
        }

        vscode.window.showErrorMessage(
            `❌ GEE Task '${description}' falló.${tip}`,
            'Copiar Detalle del Error',
            'Buscar en Google Drive'
        ).then(action => {
            if (action === 'Copiar Detalle del Error') {
                vscode.env.clipboard.writeText(errorText);
                vscode.window.showInformationMessage('Detalles del error copiados al portapapeles.');
            } else if (action === 'Buscar en Google Drive') {
                const query = encodeURIComponent(description);
                vscode.env.openExternal(vscode.Uri.parse(`https://drive.google.com/drive/u/0/search?q=${query}`));
            }
        });
    }
}
