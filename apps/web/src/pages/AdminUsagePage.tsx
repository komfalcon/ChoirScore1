import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  GetAdminAiUsageResponse,
  GetAdminSettingsResponse,
} from '@choirscore/shared';
import { AppHeader } from '../components/AppHeader';
import {
  getAdminAiUsage,
  getAdminSettings,
  updateAiGlobalEnabled,
} from '../lib/adminSettings';
import { getAiGlobalToggleIntent } from '../lib/adminUsageSafety';
import './AdminUsagePage.css';

type DashboardData = GetAdminAiUsageResponse;

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Please try again.';
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatDay(date: string) {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function UsageChart({ daily }: { daily: DashboardData['daily'] }) {
  const chart = useMemo(() => {
    const width = 720;
    const height = 232;
    const left = 44;
    const right = 12;
    const top = 12;
    const bottom = 34;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maximum = Math.max(1, ...daily.map((day) => day.requests));
    const slot = plotWidth / daily.length;
    const bars = daily.map((day, index) => {
      const x = left + index * slot + Math.max(1, slot * 0.15);
      const barWidth = Math.max(2, slot * 0.7);
      let y = top + plotHeight;
      const segments = [
        { key: 'succeeded', value: day.succeededRequests, fill: '#2f754b' },
        { key: 'failed', value: day.failedRequests, fill: '#a83936' },
        { key: 'pending', value: day.pendingRequests, fill: '#87928b' },
      ];
      const rectangles = segments.map((segment) => {
        const segmentHeight = (segment.value / maximum) * plotHeight;
        y -= segmentHeight;
        return segment.value > 0 ? (
          <rect
            key={segment.key}
            x={x}
            y={y}
            width={barWidth}
            height={segmentHeight}
            fill={segment.fill}
          />
        ) : null;
      });
      return (
        <g key={day.date}>
          <title>
            {`${formatDay(day.date)}: ${day.requests} requests; ${day.succeededRequests} succeeded, ${day.failedRequests} failed, ${day.pendingRequests} pending.`}
          </title>
          {rectangles}
          {(index === 0 ||
            index === 7 ||
            index === 14 ||
            index === 21 ||
            index === 29) && (
            <text
              x={left + index * slot + slot / 2}
              y={height - 10}
              textAnchor="middle"
              className="usage-chart__date"
            >
              {formatDay(day.date)}
            </text>
          )}
        </g>
      );
    });
    const grid = [0, 0.5, 1].map((fraction) => {
      const y = top + plotHeight * (1 - fraction);
      return (
        <g key={fraction}>
          <line
            x1={left}
            x2={width - right}
            y1={y}
            y2={y}
            className="usage-chart__gridline"
          />
          <text
            x={left - 8}
            y={y + 4}
            textAnchor="end"
            className="usage-chart__tick"
          >
            {Math.round(maximum * fraction)}
          </text>
        </g>
      );
    });
    return { width, height, bars, grid, maximum };
  }, [daily]);

  const latestPeakDay = daily.reduce(
    (peak, day) => (day.requests > peak.requests ? day : peak),
    daily[0]!
  );
  return (
    <>
      <svg
        className="usage-chart"
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
        aria-label={`AI requests by outcome over the last 30 UTC days. Peak: ${latestPeakDay.requests} requests on ${formatDay(latestPeakDay.date)}.`}
        preserveAspectRatio="none"
      >
        {chart.grid}
        {chart.bars}
      </svg>
      <div className="usage-chart__legend" aria-hidden="true">
        <span>
          <i className="usage-chart__swatch usage-chart__swatch--success" />
          Succeeded
        </span>
        <span>
          <i className="usage-chart__swatch usage-chart__swatch--failure" />
          Failed
        </span>
        <span>
          <i className="usage-chart__swatch usage-chart__swatch--pending" />
          Queued or running
        </span>
      </div>
      <table className="sr-only">
        <caption>Daily AI usage for the last 30 UTC days</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Requests</th>
            <th scope="col">Succeeded</th>
            <th scope="col">Failed</th>
            <th scope="col">Queued or running</th>
            <th scope="col">Total tokens</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.date}</th>
              <td>{day.requests}</td>
              <td>{day.succeededRequests}</td>
              <td>{day.failedRequests}</td>
              <td>{day.pendingRequests}</td>
              <td>{day.totalTokens}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="usage-chart__scale-note">
        Bars show accepted requests; token totals are included in the accessible
        data table.
      </p>
    </>
  );
}

function UsageSummary({ usage }: { usage: DashboardData }) {
  const totals = usage.users.reduce(
    (summary, user) => ({
      requestsToday: summary.requestsToday + user.requestsToday,
      succeededRequests: summary.succeededRequests + user.succeededRequests,
      failedRequests: summary.failedRequests + user.failedRequests,
      totalTokens: summary.totalTokens + user.totalTokens,
    }),
    {
      requestsToday: 0,
      succeededRequests: 0,
      failedRequests: 0,
      totalTokens: 0,
    }
  );
  const stats = [
    {
      label: 'Requests today · UTC',
      value: totals.requestsToday,
      tone: 'green',
    },
    {
      label: 'Succeeded · 30 days',
      value: totals.succeededRequests,
      tone: 'blue',
    },
    { label: 'Failed · 30 days', value: totals.failedRequests, tone: 'gold' },
    { label: 'Tokens · 30 days', value: totals.totalTokens, tone: 'lavender' },
  ];
  return (
    <div className="user-stats admin-usage-stats">
      {stats.map((stat) => (
        <article className="user-stat" key={stat.label}>
          <span
            className={`user-stat__icon user-stat__icon--${stat.tone}`}
            aria-hidden="true"
          >
            {stat.label.startsWith('Requests')
              ? '↗'
              : stat.label.startsWith('Succeeded')
                ? '✓'
                : stat.label.startsWith('Failed')
                  ? '!'
                  : 'Σ'}
          </span>
          <div>
            <strong>{formatNumber(stat.value)}</strong>
            <span>{stat.label}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

export function AdminUsagePage() {
  const [usage, setUsage] = useState<DashboardData | null>(null);
  const [settings, setSettings] = useState<GetAdminSettingsResponse | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [nextUsage, nextSettings] = await Promise.all([
        getAdminAiUsage(),
        getAdminSettings(),
      ]);
      setUsage(nextUsage);
      setSettings(nextSettings);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function saveGlobalEnabled(aiGlobalEnabled: boolean) {
    if (saving || !settings) return;
    setSaving(true);
    setSaveError('');
    setSavedMessage('');
    setConfirmingDisable(false);
    try {
      const updated = await updateAiGlobalEnabled(aiGlobalEnabled);
      setSettings(updated);
      setSavedMessage(
        aiGlobalEnabled
          ? 'AI has been enabled globally.'
          : 'AI has been disabled globally. New requests are blocked; accepted jobs will continue.'
      );
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const totalRequests =
    usage?.daily.reduce((total, day) => total + day.requests, 0) ?? 0;

  return (
    <div className="app-page">
      <AppHeader />
      <main className="admin-usage-main" id="main-content" tabIndex={-1}>
        <div className="admin-page-heading">
          <div>
            <p className="eyebrow">ADMINISTRATION · AI USAGE</p>
            <h1>AI usage</h1>
            <p>Monitor accepted AI requests, outcomes, and token totals.</p>
          </div>
          <button
            className="button button--quiet admin-usage-refresh"
            type="button"
            disabled={loading || saving}
            onClick={() => void loadDashboard()}
          >
            {loading ? 'Refreshing…' : 'Refresh usage'}
          </button>
        </div>

        {loading && !usage ? (
          <div className="list-state" role="status" aria-busy="true">
            <span className="loading-spinner" aria-hidden="true" />
            <h2>Loading AI usage…</h2>
          </div>
        ) : loadError && !usage ? (
          <div className="list-state list-state--error" role="alert">
            <h2>AI usage could not be loaded</h2>
            <p>{loadError}</p>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => void loadDashboard()}
            >
              Try again
            </button>
          </div>
        ) : usage && settings ? (
          <>
            {loadError ? (
              <div
                className="feedback-banner feedback-banner--error"
                role="alert"
              >
                AI usage could not be refreshed: {loadError}
              </div>
            ) : null}
            <section
              className={`admin-usage-kill ${settings.aiGlobalEnabled ? '' : 'admin-usage-kill--disabled'}`}
              aria-labelledby="global-ai-heading"
            >
              <div className="admin-usage-kill__copy">
                <p className="eyebrow">GLOBAL CONTROL</p>
                <h2 id="global-ai-heading">AI availability</h2>
                <p>
                  {settings.aiGlobalEnabled
                    ? 'AI is enabled. New requests still follow each user’s access and daily quota.'
                    : 'AI is disabled globally. New requests are blocked; already accepted jobs continue.'}
                </p>
              </div>
              <button
                className="admin-usage-switch"
                type="button"
                role="switch"
                aria-checked={settings.aiGlobalEnabled}
                aria-label="Enable AI globally"
                aria-expanded={confirmingDisable}
                aria-controls={
                  confirmingDisable ? 'confirm-disable-actions' : undefined
                }
                disabled={saving}
                onClick={() => {
                  if (
                    getAiGlobalToggleIntent(settings.aiGlobalEnabled) ===
                    'confirm-disable'
                  ) {
                    setConfirmingDisable(true);
                    setSaveError('');
                    setSavedMessage('');
                  } else {
                    void saveGlobalEnabled(true);
                  }
                }}
              >
                <span className="admin-usage-switch__track" aria-hidden="true">
                  <span />
                </span>
                <span>{settings.aiGlobalEnabled ? 'Enabled' : 'Disabled'}</span>
              </button>
              {confirmingDisable ? (
                <div
                  className="admin-usage-confirm"
                  id="confirm-disable-actions"
                  role="group"
                  aria-labelledby="confirm-disable-title"
                >
                  <div>
                    <h3 id="confirm-disable-title">Disable AI for everyone?</h3>
                    <p>
                      This blocks new AI requests across the choir. Queued and
                      running jobs are not cancelled.
                    </p>
                  </div>
                  <div className="admin-usage-confirm__actions">
                    <button
                      className="button button--danger"
                      type="button"
                      disabled={saving}
                      onClick={() => void saveGlobalEnabled(false)}
                    >
                      {saving ? 'Disabling…' : 'Disable AI globally'}
                    </button>
                    <button
                      className="button button--quiet"
                      type="button"
                      disabled={saving}
                      onClick={() => setConfirmingDisable(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              {saveError ? (
                <p
                  className="admin-usage-feedback admin-usage-feedback--error"
                  role="alert"
                >
                  {saveError}
                </p>
              ) : null}
              {savedMessage ? (
                <p className="admin-usage-feedback" role="status">
                  {savedMessage}
                </p>
              ) : null}
            </section>

            <UsageSummary usage={usage} />

            <section
              className="users-panel admin-usage-panel"
              aria-labelledby="usage-chart-heading"
            >
              <div className="users-panel__top">
                <div>
                  <h2 id="usage-chart-heading">Daily request activity</h2>
                  <p>
                    Last 30 UTC calendar days · {usage.windowStart.slice(0, 10)}{' '}
                    to {usage.daily.at(-1)?.date}
                  </p>
                </div>
                <span className="result-count">
                  {formatNumber(totalRequests)} requests
                </span>
              </div>
              {totalRequests === 0 ? (
                <p className="admin-usage-empty" role="status">
                  No accepted AI requests in the last 30 days. Daily activity
                  will appear here when requests are accepted.
                </p>
              ) : null}
              <div className="admin-usage-chart-wrap">
                <UsageChart daily={usage.daily} />
              </div>
            </section>

            <section
              className="users-panel admin-usage-panel"
              aria-labelledby="usage-users-heading"
            >
              <div className="users-panel__top">
                <div>
                  <h2 id="usage-users-heading">Usage by user</h2>
                  <p>
                    Requests today use the current UTC day. Outcomes and tokens
                    cover the last 30 UTC days.
                  </p>
                </div>
                <span className="result-count">
                  {formatNumber(usage.users.length)} users
                </span>
              </div>
              <div className="users-table-wrap">
                <table className="users-table admin-usage-table">
                  <caption className="sr-only">
                    AI requests and token totals by user
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">User</th>
                      <th scope="col">Requests today</th>
                      <th scope="col">Requests · 30d</th>
                      <th scope="col">Succeeded · 30d</th>
                      <th scope="col">Failed · 30d</th>
                      <th scope="col">Tokens · 30d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.users.map((user) => (
                      <tr key={user.userId}>
                        <td>
                          <div className="person-details">
                            <strong>{user.displayName}</strong>
                            <span>@{user.username}</span>
                          </div>
                        </td>
                        <td>{formatNumber(user.requestsToday)}</td>
                        <td>{formatNumber(user.requestsInWindow)}</td>
                        <td>{formatNumber(user.succeededRequests)}</td>
                        <td>{formatNumber(user.failedRequests)}</td>
                        <td>{formatNumber(user.totalTokens)}</td>
                      </tr>
                    ))}
                    {usage.users.length === 0 ? (
                      <tr>
                        <td colSpan={6}>No users to report yet.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
