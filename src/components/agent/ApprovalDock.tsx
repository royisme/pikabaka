import React, { useEffect, useState } from 'react';
import type { AgentApprovalRequest } from '../../types/electron';

const TITLE: Record<AgentApprovalRequest['tool'], string> = {
    bash: 'Pika wants to run a command',
    write: 'Pika wants to write a file',
    edit: 'Pika wants to edit a file',
    read: 'Pika wants to read a file',
};

/**
 * Asks before the agent acts. It sits above the chat, outside the thread, so it cannot scroll away,
 * and it shows exactly what would happen. Allow is the one filled control while a request waits.
 */
const ApprovalDock: React.FC = () => {
    const [pending, setPending] = useState<AgentApprovalRequest[]>([]);

    useEffect(() => {
        const api = window.electronAPI;
        let alive = true;
        api?.agentApprovalsList?.().then((list) => { if (alive) setPending(list); }).catch(() => {});
        const off = api?.onAgentApproval?.((event) => {
            setPending((current) =>
                event.type === 'requested'
                    ? [...current.filter((item) => item.id !== event.request.id), event.request]
                    : current.filter((item) => item.id !== event.id)
            );
        });
        return () => { alive = false; off?.(); };
    }, []);

    const request = pending[0];
    if (!request) return null;

    const answer = (allowed: boolean) => { void window.electronAPI.agentApprovalRespond({ id: request.id, allowed }); };

    return (
        <section role="alertdialog" aria-label={TITLE[request.tool]} className="no-drag shrink-0 border-b overlay-hairline px-3 py-2 overlay-text-primary">
            <p className="text-[12px] font-medium">{TITLE[request.tool]}</p>
            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded-md border overlay-hairline px-2 py-1 text-[12px] font-mono">{request.target}</pre>
            {request.detail !== undefined && (
                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md border overlay-hairline px-2 py-1 text-[12px] font-mono">{request.detail}</pre>
            )}
            {request.outside && <p className="mt-1 text-[11px] font-medium overlay-text-secondary">This path is outside the meeting folder.</p>}
            <p className="mt-1 text-[11px] overlay-text-secondary break-all">
                {request.tool === 'bash' ? 'Runs as you, with your file access. ' : ''}Folder: {request.folder}
            </p>
            <div className="mt-2 flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => answer(true)}
                    className="h-7 rounded-full bg-[var(--overlay-action)] px-3 text-[11px] font-medium text-white hover:brightness-95"
                >
                    Allow
                </button>
                <button
                    type="button"
                    onClick={() => answer(false)}
                    className="h-7 rounded-full border overlay-hairline px-3 text-[11px] font-medium overlay-text-secondary hover:text-[var(--overlay-text-primary)]"
                >
                    Deny
                </button>
                {pending.length > 1 && <span className="text-[11px] overlay-text-secondary">{pending.length - 1} more waiting</span>}
            </div>
        </section>
    );
};

export default ApprovalDock;
