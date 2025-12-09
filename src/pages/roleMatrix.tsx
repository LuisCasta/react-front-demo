import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api/client";

const ACTIONS = ["read", "create", "update", "delete"] as const;
type Action = (typeof ACTIONS)[number];

type User = { id: number; name: string };
type Module = { id: number; name: string; fields?: string[] | string };
type Permission = {
  id?: number;
  roleId: number;
  moduleId: number;
  actions: string[];
  visibleFields?: string[];
  editableFields?: string[];
};
type UserRole = { id?: number; userId: number; roleId: number };
type Role = { id: number; name: string };

const urlAPi = 'https://node-dummy-roles-and-permissions.onrender.com';

export default function RoleMatrix() {
  const [activeTab, setActiveTab] = useState<"permissions" | "assign">("permissions");

  const [users, setUsers] = useState<User[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  // modal to edit fields (existing)
  const [fieldsModal, setFieldsModal] = useState({
    open: false,
    permId: null as number | null,
    moduleId: null as number | null,
    roleId: null as number | null,
    visibleFields: [] as string[],
    editableFields: [] as string[],
    allFields: [] as string[],
  });

  // modal to select role(s) for toggling an action for a user/module
  const [actionModal, setActionModal] = useState({
    open: false,
    userId: null as number | null,
    moduleId: null as number | null,
    action: null as Action | null,
    // which roles (roleId -> boolean) are selected to enable action
    selectedRoles: {} as Record<number, boolean>,
    // user's roles list (for convenience)
    userRolesList: [] as Role[],
  });

  // Helper: load everything
  const loadAll = async () => {
    setLoading(true);
    const [uRes, mRes, pRes, urRes, rRes] = await Promise.all([
      apiGet("/api/user/"),
      apiGet("/api/module/"),
      apiGet("/api/permissions/"),
      apiGet("/api/userRole/"),
      apiGet("/api/role/"),
    ]);
    setUsers(uRes.data);
    setModules(mRes.data);
    setPermissions(pRes.data);
    setUserRoles(urRes.data);
    setRoles(rRes.data);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  // Map roleId-moduleId => permission
  const permMap = useMemo(() => {
    const m = new Map<string, Permission>();
    permissions.forEach((p) => m.set(`${p.roleId}-${p.moduleId}`, p));
    return m;
  }, [permissions]);

  // helper: user -> array of roleIds
  const userRoleIds = (userId: number) =>
    userRoles.filter((ur) => ur.userId === userId).map((ur) => ur.roleId);

  // helper: user -> array of Role objects
  const userRolesObjects = (userId: number) => {
    const ids = userRoleIds(userId);
    return roles.filter((r) => ids.includes(r.id));
  };

  // CHECKED STATE: a checkbox in matrix is checked if ANY role assigned to the user grants the action
  const userHasAction = (userId: number, moduleId: number, action: Action) => {
    const roleIds = userRoleIds(userId);
    for (const rid of roleIds) {
      const perm = permMap.get(`${rid}-${moduleId}`);
      if (perm && perm.actions && perm.actions.includes(action)) return true;
    }
    return false;
  };

  // UNION of visibleFields / editableFields across all user's roles for display
  const unionFieldsForUserModule = (userId: number, moduleId: number) => {
    const roleIds = userRoleIds(userId);
    const visible = new Set<string>();
    const editable = new Set<string>();
    roleIds.forEach((rid) => {
      const p = permMap.get(`${rid}-${moduleId}`);
      if (!p) return;
      (p.visibleFields || []).forEach((f: string) => visible.add(f));
      (p.editableFields || []).forEach((f: string) => editable.add(f));
    });
    return { visible: Array.from(visible), editable: Array.from(editable) };
  };

  // When user clicks a checkbox in matrix, open modal letting them choose in which role(s) to toggle this action
  const openActionModal = (userId: number, moduleId: number, action: Action) => {
    const userRolesObjs = userRolesObjects(userId);
    if (userRolesObjs.length === 0) {
      // nothing to edit — user has no roles
      alert("User has no roles assigned. Assign a role first.");
      return;
    }

    // prepare selectedRoles initial state = which roles currently have the action
    const selected: Record<number, boolean> = {};
    userRolesObjs.forEach((r) => {
      const p = permMap.get(`${r.id}-${moduleId}`);
      selected[r.id] = !!(p && p.actions && p.actions.includes(action));
    });

    setActionModal({
      open: true,
      userId,
      moduleId,
      action,
      selectedRoles: selected,
      userRolesList: userRolesObjs,
    });
  };

  // Apply action toggles: for each selected role determine if action should be present or not, then call backend accordingly
  const applyActionModal = async () => {
    if (!actionModal.userId || !actionModal.moduleId || !actionModal.action) return;

    const targetAction = actionModal.action;
    const roleEntries = Object.entries(actionModal.selectedRoles).map(([k, v]) => ({
      roleId: Number(k),
      enabled: v,
    }));

    // For each role, check current permission and update/create accordingly
    for (const { roleId, enabled } of roleEntries) {
      const key = `${roleId}-${actionModal.moduleId}`;
      const perm = permMap.get(`${roleId}-${actionModal.moduleId}`);

      if (!perm) {
        // if enabled -> create new permission with this action
        if (enabled) {
          const payload: Permission = {
            roleId,
            moduleId: Number(actionModal.moduleId),
            actions: [targetAction],
            visibleFields: [],
            editableFields: [],
          };
          try {
            await fetch(urlAPi+"/api/permissions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
          } catch (e) {
            console.error(e);
          }
        }
        // if disabled and no perm -> nothing to do
      } else {
        // perm exists -> update actions array based on enabled
        const has = perm.actions.includes(targetAction);
        let newActions = perm.actions.slice();
        if (enabled && !has) newActions.push(targetAction);
        if (!enabled && has) newActions = newActions.filter((a) => a !== targetAction);

        // call PUT
        try {
          await fetch(`${urlAPi}/api/permissions/${perm.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...perm, actions: newActions }),
          });
        } catch (e) {
          console.error(e);
        }
      }
    }

    // reload all data to keep sync
    await loadAll();
    setActionModal({
      open: false,
      userId: null,
      moduleId: null,
      action: null,
      selectedRoles: {},
      userRolesList: [],
    });
  };

  // ---------- Fields editor (existing) ----------
  const openFieldsEditor = (userId: number, moduleObj: Module) => {
    const rel = userRoles.find((ur) => ur.userId === userId);
    if (!rel) {
      alert("Assign a role to the user first to edit fields for that role/module.");
      return;
    }
    const perm = permMap.get(`${rel.roleId}-${moduleObj.id}`) || null;

    // normalize module fields
    let allFields: string[] = [];
    if (Array.isArray(moduleObj.fields)) allFields = moduleObj.fields;
    else {
      try {
        allFields = JSON.parse((moduleObj.fields as any) || "[]");
      } catch {
        allFields = [];
      }
    }

    setFieldsModal({
      open: true,
      permId: perm?.id ?? null,
      moduleId: moduleObj.id,
      roleId: rel.roleId,
      visibleFields: perm?.visibleFields ?? [],
      editableFields: perm?.editableFields ?? [],
      allFields,
    });
  };

  const saveFieldsModal = async () => {
    if (!fieldsModal.moduleId || !fieldsModal.roleId) {
      setFieldsModal({ ...fieldsModal, open: false });
      return;
    }
    const existing = permissions.find(
      (p) => p.roleId === fieldsModal.roleId && p.moduleId === fieldsModal.moduleId
    );
    if (existing) {
      await fetch(`${urlAPi}/api/permissions/${existing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...existing,
          visibleFields: fieldsModal.visibleFields,
          editableFields: fieldsModal.editableFields,
        }),
      });
    } else {
      // create
      await fetch(urlAPi+"/api/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleId: fieldsModal.roleId,
          moduleId: fieldsModal.moduleId,
          actions: [],
          visibleFields: fieldsModal.visibleFields,
          editableFields: fieldsModal.editableFields,
        }),
      });
    }
    await loadAll();
    setFieldsModal({ ...fieldsModal, open: false });
  };

  // ---------- Assign Roles tab logic (simple local update + backend) ----------
  const toggleRoleForUser = async (userId: number, roleId: number) => {
    const existing = userRoles.find((ur) => ur.userId === userId && ur.roleId === roleId);
    if (existing) {
      // delete relationship if backend supports DELETE /api/userRole/:id
      if (existing.id) {
        await fetch(`${urlAPi}/api/userRole/${existing.id}`, {
          method: "DELETE",
        });
        setUserRoles((prev) => prev.filter((u) => u.id !== existing.id));
      }
    } else {
      // create
      const res = await fetch(urlAPi+"/api/userRole", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, roleId }),
      });
      const json = await res.json();
      setUserRoles((prev) => [...prev, json.data]);
    }
    // reload permissions because roles changed
    await loadAll();
  };

  if (loading) return <div style={{ padding: 20 }}>Loading permissions...</div>;

  // UI styles (concise)
  const containerStyle: React.CSSProperties = { padding: 20, fontFamily: "Inter, Arial", minHeight: "100vh", background: "#f6f8fb" };
  const tabBtn: React.CSSProperties = { padding: "10px 14px", marginRight: 8, borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" };
  const activeTabBtn: React.CSSProperties = { ...tabBtn, background: "#111827", color: "#fff", border: "1px solid #111827" };

  return (
    <div style={containerStyle}>
      <h2 style={{ marginBottom: 12 }}>Authorization Management</h2>

      <div style={{ marginBottom: 16 }}>
        <button style={activeTab === "permissions" ? activeTabBtn : tabBtn} onClick={() => setActiveTab("permissions")}>Permissions</button>
        <button style={activeTab === "assign" ? activeTabBtn : tabBtn} onClick={() => setActiveTab("assign")}>Assign Roles</button>
      </div>

      {activeTab === "permissions" ? (
        /* Permissions matrix: users x modules */
        <div style={{ background: "#fff", padding: 12, borderRadius: 10, boxShadow: "0 6px 18px rgba(0,0,0,0.06)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th style={{ textAlign: "left", padding: 12 }}>User</th>
                {modules.map((m) => <th key={m.id} style={{ padding: 12, textAlign: "center" }}>{m.name}</th>)}
              </tr>
            </thead>

            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 12, width: 220, background: "#fafafa", fontWeight: 600 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                      <div>
                        <div>{u.name}</div>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                          Roles: {userRoleIds(u.id).map((rid) => roles.find(r => r.id === rid)?.name).filter(Boolean).join(", ") || "None"}
                        </div>
                      </div>
                    </div>
                  </td>

                  {modules.map((m) => {
                    const { visible, editable } = unionFieldsForUserModule(u.id, m.id);
                    return (
                      <td key={m.id} style={{ padding: 12, verticalAlign: "top" }}>
                        {/* actions: checkbox shows union result; click opens role-selection modal */}
                        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginBottom: 8 }}>
                          {ACTIONS.map((a) => (
                            <label key={a} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
                              <input
                                type="checkbox"
                                checked={userHasAction(u.id, m.id, a)}
                                readOnly
                                onClick={() => openActionModal(u.id, m.id, a)}
                                title="Click to change which role provides this action"
                              />
                              <span style={{ textTransform: "capitalize" }}>{a}</span>
                            </label>
                          ))}
                        </div>

                        <div style={{ fontSize: 12, color: "#374151", textAlign: "left" }}>
                          <div><strong>Allowed query fields:</strong> {visible.length ? visible.join(", ") : "None"}</div>
                          <div style={{ marginTop: 6 }}><strong>Allowed update fields:</strong> {editable.length ? editable.join(", ") : "None"}</div>
                        </div>

                        <div style={{ textAlign: "center", marginTop: 8 }}>
                          <button
                            onClick={() => openFieldsEditor(u.id, m)}
                            style={{ padding: "6px 10px", borderRadius: 6, border: "none", background: "#2563eb", color: "white", cursor: "pointer" }}
                          >
                            Edit fields
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Assign Roles Tab */
        <div style={{ background: "#fff", padding: 16, borderRadius: 10, boxShadow: "0 6px 18px rgba(0,0,0,0.06)" }}>
          <h3 style={{ marginTop: 0 }}>Assign Roles to Users</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                <th style={{ padding: 12, textAlign: "left" }}>User</th>
                {roles.map((r) => <th key={r.id} style={{ padding: 12, textAlign: "center" }}>{r.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 12, fontWeight: 600 }}>{u.name}</td>
                  {roles.map((r) => {
                    const has = !!userRoles.find((ur) => ur.userId === u.id && ur.roleId === r.id);
                    return (
                      <td key={r.id} style={{ padding: 12, textAlign: "center" }}>
                        <input type="checkbox" checked={has} onChange={() => toggleRoleForUser(u.id, r.id)} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ACTIONS MODAL (choose roles that should have this action for the user/module) */}
      {actionModal.open && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000
        }}>
          <div style={{ background: "white", padding: 20, borderRadius: 10, width: 420 }}>
            <h3 style={{ marginTop: 0 }}>Select roles to grant action: <span style={{ color: "#111827" }}>{actionModal.action}</span></h3>

            <div style={{ marginTop: 10 }}>
              {actionModal.userRolesList.map((r) => (
                <label key={r.id} style={{ display: "block", marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!actionModal.selectedRoles[r.id]}
                    onChange={(e) => setActionModal((m) => ({ ...m, selectedRoles: { ...m.selectedRoles, [r.id]: e.target.checked } }))}
                  />{" "}
                  {r.name}
                </label>
              ))}
            </div>

            <div style={{ textAlign: "right", marginTop: 14 }}>
              <button onClick={() => setActionModal({ open: false, userId: null, moduleId: null, action: null, selectedRoles: {}, userRolesList: [] })} style={{ marginRight: 8, padding: "8px 12px", borderRadius: 6 }}>Cancel</button>
              <button onClick={applyActionModal} style={{ padding: "8px 12px", borderRadius: 6, background: "#111827", color: "#fff", border: "none" }}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* FIELDS EDITOR MODAL */}
      {fieldsModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 }}>
          <div style={{ background: "white", padding: 22, borderRadius: 10, width: 520 }}>
            <h3 style={{ marginTop: 0 }}>Edit fields for role/module</h3>

            <div style={{ marginTop: 10 }}>
              <strong>Allowed query fields</strong>
              <div style={{ marginTop: 8 }}>
                {fieldsModal.allFields.map((f) => (
                  <label key={f} style={{ display: "block", marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      checked={fieldsModal.visibleFields.includes(f)}
                      onChange={() => setFieldsModal((m) => ({ ...m, visibleFields: m.visibleFields.includes(f) ? m.visibleFields.filter(x => x !== f) : [...m.visibleFields, f] }))}
                    />{" "}
                    {f}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <strong>Allowed update fields</strong>
              <div style={{ marginTop: 8 }}>
                {fieldsModal.allFields.map((f) => (
                  <label key={f} style={{ display: "block", marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      checked={fieldsModal.editableFields.includes(f)}
                      onChange={() => setFieldsModal((m) => ({ ...m, editableFields: m.editableFields.includes(f) ? m.editableFields.filter(x => x !== f) : [...m.editableFields, f] }))}
                    />{" "}
                    {f}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ textAlign: "right", marginTop: 14 }}>
              <button onClick={() => setFieldsModal({ ...fieldsModal, open: false })} style={{ marginRight: 8, padding: "8px 12px", borderRadius: 6 }}>Cancel</button>
              <button onClick={saveFieldsModal} style={{ padding: "8px 12px", borderRadius: 6, background: "#111827", color: "white", border: "none" }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
