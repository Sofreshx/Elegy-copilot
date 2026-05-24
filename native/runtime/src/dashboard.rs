use std::path::Path;

use elegy_native_contracts::{DashboardRecentActivityItem, DashboardSummaryResponse};

use crate::sessions::list_sessions;

pub fn build_dashboard_summary(copilot_home: &Path) -> DashboardSummaryResponse {
    let sessions = list_sessions(copilot_home);
    let active_session_count = sessions
        .iter()
        .filter(|session| session.status == "active")
        .count();
    let total_session_count = sessions.len();
    let recent_activity = sessions
        .iter()
        .take(10)
        .map(|session| DashboardRecentActivityItem {
            r#type: "session".to_string(),
            timestamp: session.last_event_time.or(session.start_time),
            summary: format!("Session {} [{}]", session.id, session.status),
        })
        .collect::<Vec<_>>();
    let health_indicator = derive_health_indicator(&sessions);

    DashboardSummaryResponse {
        active_session_count,
        total_session_count,
        recent_activity,
        health_indicator,
    }
}

fn derive_health_indicator(sessions: &[crate::sessions::SessionSummary]) -> String {
    let mut health = "ok";
    for session in sessions {
        match session.status.as_str() {
            "error" => return "error".to_string(),
            "failed" | "missing" => health = "degraded",
            _ => {}
        }
    }
    health.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dashboard_summary_defaults_to_ok_without_sessions() {
        assert_eq!(derive_health_indicator(&[]), "ok");
    }
}
