import { useState, useEffect } from 'react';
import { api, ApiError } from '../lib/api';
import './Reports.css';

export interface ModerationTask {
  id: string;
  reportId: string;
  reporterId: string;
  reportedUserId: string;
  targetType: 'post' | 'image';
  targetId: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  reviewedAt?: string;
  reviewerId?: string;
  reviewNote?: string;
}

export function Reports() {
  const [tasks, setTasks] = useState<ModerationTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<{ tasks: ModerationTask[] }>('/moderation/reports/pending');
      setTasks(data.tasks);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('加载失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleReview(taskId: string, action: 'approve' | 'reject', note: string) {
    setProcessingId(taskId);
    try {
      await api.post(`/moderation/tasks/${taskId}/review`, { action, note });
      setTasks(tasks.filter((t) => t.id !== taskId));
    } catch (err) {
      if (err instanceof ApiError) {
        alert(`操作失败: ${err.message}`);
      } else {
        alert('操作失败，请重试');
      }
    } finally {
      setProcessingId(null);
    }
  }

  function handleApprove(task: ModerationTask) {
    const note = prompt('批准原因（可选）:');
    if (note !== null) {
      handleReview(task.id, 'approve', note);
    }
  }

  function handleReject(task: ModerationTask) {
    const note = prompt('驳回原因:');
    if (note) {
      handleReview(task.id, 'reject', note);
    }
  }

  if (loading) {
    return (
      <div className="reports-container">
        <div className="loading">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="reports-container">
        <div className="error">{error}</div>
        <button onClick={loadTasks}>重试</button>
      </div>
    );
  }

  return (
    <div className="reports-container">
      <div className="reports-header">
        <h1>待审核工单</h1>
        <button onClick={loadTasks} className="refresh-btn">
          刷新
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="empty-state">暂无待审核工单</div>
      ) : (
        <div className="reports-list">
          {tasks.map((task) => (
            <div key={task.id} className="report-card">
              <div className="report-header">
                <span className="target-type">
                  {task.targetType === 'post' ? '🏞 动态' : '🖼 图片'}
                </span>
                <span className="report-time">
                  {new Date(task.createdAt).toLocaleString('zh-CN')}
                </span>
              </div>
              <div className="report-body">
                <div className="report-row">
                  <span className="label">举报人ID:</span>
                  <span className="value">{task.reporterId}</span>
                </div>
                <div className="report-row">
                  <span className="label">被举报用户:</span>
                  <span className="value">{task.reportedUserId}</span>
                </div>
                <div className="report-row">
                  <span className="label">目标ID:</span>
                  <span className="value">{task.targetId}</span>
                </div>
                <div className="report-row">
                  <span className="label">举报原因:</span>
                  <span className="value reason">{task.reason}</span>
                </div>
              </div>
              <div className="report-actions">
                <button
                  onClick={() => handleApprove(task)}
                  disabled={processingId === task.id}
                  className="approve-btn"
                >
                  ✓ 批准
                </button>
                <button
                  onClick={() => handleReject(task)}
                  disabled={processingId === task.id}
                  className="reject-btn"
                >
                  ✗ 驳回
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
