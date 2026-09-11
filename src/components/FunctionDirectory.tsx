"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ModuleInfo } from "@/lib/types";
import { funcCode } from "@/lib/terminal";
import { getFunctionTasks, taskLink, deskLink } from "@/lib/functionMenus";

// Bloomberg-style gateway directory: dense FNC | DESK | DESCRIPTION table
// exactly like the reference screenshot. Clicking a row expands its task
// menu; picking a task deep-links into that desk with ?task=.
export default function FunctionDirectory({
  ticker,
  modules,
  total,
}: {
  ticker: string;
  modules: ModuleInfo[];
  total: number;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useMemo(() => `${modules.length}/${total}`, [modules.length, total]);

  function toggle(id: string) {
    setOpenId((cur) => (cur === id ? null : id));
  }

  function openTask(mod: ModuleInfo, taskLabel: string) {
    const tasks = getFunctionTasks(mod);
    const task = tasks.find((x) => x.label === taskLabel) ?? tasks[0];
    if (!task) {
      router.push(deskLink(mod, ticker));
      return;
    }
    router.push(taskLink(mod, ticker, task));
  }

  return (
    <div className="panel fndir-panel">
      <p className="p-head">
        Function directory — {counts}
        <span className="faint" style={{ fontWeight: 400 }}>
          {" "}
          · CLICK A ROW FOR ITS MENU
        </span>
      </p>
      <table className="fntbl fndir">
        <thead>
          <tr>
            <th style={{ width: 72 }}>FNC</th>
            <th style={{ width: 300 }}>DESK</th>
            <th>DESCRIPTION</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => {
            const code = funcCode(m.id);
            const open = openId === m.id;
            const tasks = open ? getFunctionTasks(m) : [];
            return [
              <tr
                key={m.id}
                className={open ? "active" : ""}
                onClick={() => toggle(m.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle(m.id);
                  }
                }}
                tabIndex={0}
                title={`${code} — CLICK FOR MENU`}
              >
                <td className="fnc">
                  <span className="fnc-caret">{open ? "▾" : "▸"}</span> {code}
                </td>
                <td className="desk">{m.label}</td>
                <td className="desc">{m.description}</td>
              </tr>,
              open ? (
                <tr key={`${m.id}-menu`} className="fnmenu-row">
                  <td colSpan={3}>
                    <div className="fnmenu">
                      <div className="fnmenu-head">
                        <span>
                          <span className="badge fnc">{code}</span>{" "}
                          <strong>{m.label.toUpperCase()}</strong>
                          <span className="faint"> · PICK A TASK → OPENS ITS DESK</span>
                        </span>
                        <span className="fnmenu-actions">
                          <button
                            className="ghost fnmenu-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(deskLink(m, ticker));
                            }}
                          >
                            OPEN {code} ›
                          </button>
                          <button
                            className="ghost fnmenu-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenId(null);
                            }}
                          >
                            CLOSE ✕
                          </button>
                        </span>
                      </div>
                      <div className="fnmenu-grid">
                        {tasks.map((task, i) => (
                          <button
                            key={task.key}
                            className="fntask"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTask(m, task.label);
                            }}
                            title={`${ticker} ${code} ${task.label}`}
                          >
                            <span className="faint fntask-num">{i + 1})</span>
                            <span className="fntask-label">{task.label}</span>
                            <span className="faint fntask-hint">{task.hint}</span>
                            <span className="sec fntask-go">›</span>
                          </button>
                        ))}
                      </div>
                      <div className="faint fnmenu-cmd">
                        CMD: {ticker} {code} + ENTER = &lt;GO&gt; · TASK IS CARRIED AS ?task= INTO THE DESK
                      </div>
                    </div>
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
      {modules.length === 0 && <p className="muted">NO FUNCTIONS MATCH — CLEAR THE FILTER.</p>}
    </div>
  );
}
