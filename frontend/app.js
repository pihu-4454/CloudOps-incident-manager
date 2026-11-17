
const API_URL = "/api/incidents";
const EMPTY_MESSAGE = "No active incidents. Create one to get started.";
 
const $ = (selector) => document.querySelector(selector);
 
let incidents = [];
let hasLoaded = false;
 
/* ---------- Helpers ---------- */
 
function titleCase(text) {
  return text.charAt(0) + text.slice(1).toLowerCase();
}
 
function isToday(date) {
  return date && new Date(date).toDateString() === new Date().toDateString();
}
 
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
 
function showMessage(message) {
  const emptyState = $("#empty-state");
  emptyState.textContent = message;
  emptyState.hidden = false;
}
 
/* ---------- API ---------- */
 
async function api(path = "", options = {}) {
  let response;
 
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
  } catch {
    throw new Error("Cannot reach the server. Please check your connection.");
  }
 
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
 
    try {
      const body = await response.json();
 
      if (typeof body.detail === "string") {
        message = body.detail;
      } else if (Array.isArray(body.detail)) {
        message = body.detail.map((item) => item.msg).join(", ");
      }
    } catch {
      // Response had no JSON body; keep the default message.
    }
 
    throw new Error(message);
  }
 
  if (response.status === 204) return null;
  return response.json();
}
 
async function loadIncidents() {
  try {
    incidents = await api();
    hasLoaded = true;
    renderDashboard();
  } catch (error) {
    if (hasLoaded) {
      window.alert(`Could not refresh incidents: ${error.message}`);
    } else {
      renderDashboard();
      showMessage(
        "Could not load incidents. Make sure the server is running, then refresh the page."
      );
    }
  }
}
 
/* ---------- Rendering ---------- */
 
function renderDashboard() {
  const activeIncidents = incidents.filter(
    (incident) => incident.status !== "RESOLVED"
  );
 
  const criticalIncidents = activeIncidents.filter(
    (incident) => incident.severity === "CRITICAL"
  );
 
  const resolvedToday = incidents.filter(
    (incident) =>
      incident.status === "RESOLVED" &&
      isToday(incident.resolved_at || incident.updated_at)
  );
 
  $("#open-count").textContent = activeIncidents.length;
  $("#critical-count").textContent = criticalIncidents.length;
  $("#resolved-count").textContent = resolvedToday.length;
 
  const tableBody = $("#incidents-table-body");
 
  tableBody.innerHTML = activeIncidents
    .map(
      (incident) => `
        <tr>
          <td>
            <span class="incident-number">#${incident.id}</span>
            <span class="incident-title">${escapeHtml(incident.title)}</span>
          </td>
 
          <td>
            <span class="badge badge-${incident.severity.toLowerCase()}">
              ${incident.severity}
            </span>
          </td>
 
          <td>
            <span class="service">${escapeHtml(incident.service)}</span>
          </td>
 
          <td>
            <select
              class="status-select status-${incident.status.toLowerCase()}"
              data-id="${incident.id}">
              ${statusOptions(incident.status)}
            </select>
          </td>
 
          <td>
            <button
              class="row-button"
              type="button"
              data-edit-id="${incident.id}">
              Edit
            </button>
 
            <button
              class="delete-button"
              type="button"
              data-delete-id="${incident.id}">
              Delete
            </button>
          </td>
        </tr>
      `
    )
    .join("");
 
  $("#empty-state").textContent = EMPTY_MESSAGE;
  $("#empty-state").hidden = activeIncidents.length !== 0;
}
 
function statusOptions(currentStatus) {
  const statuses = [
    "INVESTIGATING",
    "IDENTIFIED",
    "MITIGATING",
    "RESOLVED"
  ];
 
  return statuses
    .map(
      (status) => `
        <option value="${status}" ${status === currentStatus ? "selected" : ""}>
          ${titleCase(status)}
        </option>
      `
    )
    .join("");
}
 
/* ---------- Dialog ---------- */
 
function openDialog(incident = null) {
  $("#incident-form").reset();
 
  $("#incident-id").value = incident ? incident.id : "";
  $("#dialog-title").textContent = incident
    ? "Update incident"
    : "Create incident";
 
  $("#submit-button").textContent = incident
    ? "Save changes"
    : "Create incident";
 
  if (incident) {
    $("#title").value = incident.title;
    $("#description").value = incident.description;
    $("#severity").value = incident.severity;
    $("#service").value = incident.service;
    $("#status").value = incident.status;
  }
 
  applyFormColors();
  $("#incident-dialog").showModal();
}
 
function applyFormColors() {
  const severity = $("#severity");
  const status = $("#status");
 
  severity.className = `severity-${severity.value.toLowerCase()}`;
  status.className = `status-${status.value.toLowerCase()}`;
}
 
/* ---------- Event listeners ---------- */
 
$("#open-create-modal").addEventListener("click", () => {
  openDialog();
});
 
$("#close-dialog").addEventListener("click", () => {
  $("#incident-dialog").close();
});
 
$("#cancel-dialog").addEventListener("click", () => {
  $("#incident-dialog").close();
});
 
$("#severity").addEventListener("change", applyFormColors);
$("#status").addEventListener("change", applyFormColors);
 
// Change status from the table dropdown
$("#incidents-table-body").addEventListener("change", async (event) => {
  if (!event.target.matches(".status-select")) return;
 
  const id = Number(event.target.dataset.id);
  const newStatus = event.target.value;
 
  try {
    await api(`/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status: newStatus })
    });
  } catch (error) {
    window.alert(`Could not update status: ${error.message}`);
  }
 
  // Always re-sync with the server (also resets the dropdown if the update failed)
  await loadIncidents();
});
 
// Edit / Delete buttons
$("#incidents-table-body").addEventListener("click", async (event) => {
  const deleteId = Number(event.target.dataset.deleteId);
 
  if (deleteId) {
    const incident = incidents.find((item) => item.id === deleteId);
 
    if (
      incident &&
      window.confirm(`Delete incident #${incident.id}: ${incident.title}?`)
    ) {
      try {
        await api(`/${deleteId}`, { method: "DELETE" });
      } catch (error) {
        window.alert(`Could not delete incident: ${error.message}`);
      }
 
      await loadIncidents();
    }
 
    return;
  }
 
  const editId = Number(event.target.dataset.editId);
 
  if (!editId) return;
 
  const incident = incidents.find((item) => item.id === editId);
  if (incident) {
    openDialog(incident);
  }
});
 
// Create / update form
$("#incident-form").addEventListener("submit", async (event) => {
  event.preventDefault();
 
  const id = Number($("#incident-id").value);
  const submitButton = $("#submit-button");
 
  const payload = {
    title: $("#title").value.trim(),
    description: $("#description").value.trim(),
    severity: $("#severity").value,
    service: $("#service").value.trim(),
    status: $("#status").value
  };
 
  submitButton.disabled = true;
 
  try {
    if (id) {
      await api(`/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
    } else {
      await api("", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    }
 
    $("#incident-dialog").close();
    await loadIncidents();
  } catch (error) {
    // Keep the dialog open so the user's input isn't lost
    window.alert(`Could not save incident: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
});
 
/* ---------- Start ---------- */
 
showMessage("Loading incidents…");
loadIncidents();