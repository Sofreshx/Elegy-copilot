/**
 * Permission request modal component.
 */
import { useState, useEffect } from 'react';
import { PermissionRequest, PERMISSION_LABELS } from '../../types/permissions';
import { getTimeRemaining, formatTimeRemaining } from '../../hooks/usePermissions';
import './PermissionModal.css';

interface PermissionModalProps {
  request: PermissionRequest;
  onApprove: () => void;
  onDeny: () => void;
  pendingCount: number;
  onApproveAll?: () => void;
  onDenyAll?: () => void;
}

export default function PermissionModal({
  request,
  onApprove,
  onDeny,
  pendingCount,
  onApproveAll,
  onDenyAll,
}: PermissionModalProps) {
  const [timeRemaining, setTimeRemaining] = useState(getTimeRemaining(request));
  const [isApproving, setIsApproving] = useState(false);
  const [isDenying, setIsDenying] = useState(false);

  const permissionInfo = PERMISSION_LABELS[request.type];

  // Update countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeRemaining(getTimeRemaining(request));
    }, 1000);
    return () => clearInterval(interval);
  }, [request]);

  const handleApprove = () => {
    setIsApproving(true);
    onApprove();
  };

  const handleDeny = () => {
    setIsDenying(true);
    onDeny();
  };

  return (
    <div className="permission-modal-overlay">
      <div className="permission-modal">
        <div className="permission-modal-header">
          <span className="permission-icon">{permissionInfo.icon}</span>
          <div className="permission-title-group">
            <h2 className="permission-title">{permissionInfo.label}</h2>
            <span className={`severity-badge ${permissionInfo.severity}`}>
              {permissionInfo.severity}
            </span>
          </div>
        </div>

        <div className="permission-content">
          <div className="permission-agent">
            <span className="label">Agent</span>
            <span className="value">@{request.agentName}</span>
          </div>

          <div className="permission-description">
            <span className="label">Description</span>
            <p className="value">{request.description}</p>
          </div>

          {request.details.filePath && (
            <div className="permission-detail">
              <span className="label">File</span>
              <code className="value file-path">{request.details.filePath}</code>
            </div>
          )}

          {request.details.command && (
            <div className="permission-detail">
              <span className="label">Command</span>
              <code className="value command">{request.details.command}</code>
            </div>
          )}

          {request.details.reason && (
            <div className="permission-detail">
              <span className="label">Reason</span>
              <p className="value">{request.details.reason}</p>
            </div>
          )}
        </div>

        <div className="permission-timer">
          <span className="timer-label">Auto-deny in</span>
          <span className={`timer-value ${timeRemaining < 30000 ? 'urgent' : ''}`}>
            {formatTimeRemaining(timeRemaining)}
          </span>
        </div>

        <div className="permission-actions">
          <button
            className="permission-btn deny"
            onClick={handleDeny}
            disabled={isDenying || isApproving}
          >
            {isDenying ? 'Denying...' : 'Deny'}
          </button>
          <button
            className="permission-btn approve"
            onClick={handleApprove}
            disabled={isApproving || isDenying}
          >
            {isApproving ? 'Approving...' : 'Approve'}
          </button>
        </div>

        {pendingCount > 1 && (
          <div className="permission-batch">
            <span className="batch-label">{pendingCount - 1} more pending</span>
            <div className="batch-actions">
              <button className="batch-btn" onClick={onDenyAll}>
                Deny All
              </button>
              <button className="batch-btn" onClick={onApproveAll}>
                Approve All
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
