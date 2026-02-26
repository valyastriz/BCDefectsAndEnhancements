import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import {
  Badge,
  Button,
  Input,
  MultiSelectDropdown,
  Notice,
  Select,
} from '../components/bite-size/BitsizeUI';

const publicStatuses = ['New', 'Approved', 'Rejected', 'Duplicate', 'Submitted', 'Deployed', 'Retired'];

export function PublicUpdatesPage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [live, setLive] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedStatuses, setSelectedStatuses] = useState(
    publicStatuses.filter((status) => status !== 'Retired'),
  );
  const [sortBy, setSortBy] = useState('updated_desc');

  const load = useCallback(async () => {
    try {
      setError('');
      const data = await api.listPublicSubmissions();
      setItems(data);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    Promise.resolve().then(load);
    const socket = getSocket();
    const onUpdate = () => { setLive(true); setTimeout(() => setLive(false), 3000); load(); };
    socket.on('public:update', onUpdate);
    return () => { socket.off('public:update', onUpdate); };
  }, [load]);

  const hasItems = useMemo(() => items.length > 0, [items]);

  function submittedDate(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleDateString();
  }

  function statusDate(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleString();
  }

  function descriptionForItem(item) {
    const defectDescription = String(item.what_happened_exact_details || '').trim();
    const enhancementDescription = String(item.request || '').trim();
    return defectDescription || enhancementDescription || '-';
  }

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = items.filter((item) => {
      if (typeFilter && item.type !== typeFilter) {
        return false;
      }
      if (selectedStatuses.length > 0 && !selectedStatuses.includes(item.status)) {
        return false;
      }
      if (!query) {
        return true;
      }

      const haystack = [
        item.id,
        item.created_by,
        item.policy_num,
        item.account_num,
        item.summary_of_issue,
        item.what_happened_exact_details,
        item.request,
        item.easyvista_ticket_id,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');

      return haystack.includes(query);
    });

    const toMillis = (value) => {
      const parsed = new Date(value || '').getTime();
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    filtered.sort((left, right) => {
      if (sortBy === 'updated_asc') {
        return toMillis(left.updated_at) - toMillis(right.updated_at);
      }
      if (sortBy === 'created_desc') {
        return toMillis(right.created_at) - toMillis(left.created_at);
      }
      if (sortBy === 'created_asc') {
        return toMillis(left.created_at) - toMillis(right.created_at);
      }
      return toMillis(right.updated_at) - toMillis(left.updated_at);
    });

    return filtered;
  }, [items, search, typeFilter, selectedStatuses, sortBy]);

  return (
    <>
      <div className="page-header">
        <h2>Status Board</h2>
        <p>
          Live view of submitted requests that have been marked "Public" by an admin — updates automatically when admins make changes.
          {live && <strong style={{ marginLeft: 8, color: 'var(--status-approved-fg)' }}>● Live update received</strong>}
        </p>
      </div>

      <Notice text={error} />

      <div className="filters-bar" style={{ marginBottom: 14 }}>
        <Input
          label="Search"
          placeholder="Search by summary, description, policy/account, requestor, EV ticket"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select label="Type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">All types</option>
          <option value="defect">Defect</option>
          <option value="enhancement">Enhancement</option>
        </Select>
        <MultiSelectDropdown
          label="Status"
          options={publicStatuses}
          selectedValues={selectedStatuses}
          onChange={setSelectedStatuses}
          placeholder="Select statuses"
        />
        <Select label="Sort" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
          <option value="updated_desc">Recently Updated (Newest)</option>
          <option value="updated_asc">Recently Updated (Oldest)</option>
          <option value="created_desc">Date Submitted (Newest)</option>
          <option value="created_asc">Date Submitted (Oldest)</option>
        </Select>
        <Button
          kind="ghost"
          type="button"
          onClick={() => setSelectedStatuses(publicStatuses.filter((status) => status !== 'Retired'))}
        >
          Hide Retired
        </Button>
        <Button
          kind="ghost"
          type="button"
          onClick={() => setSelectedStatuses([...publicStatuses])}
        >
          Show All Statuses
        </Button>
        <Button
          kind="ghost"
          type="button"
          onClick={() => {
            setSearch('');
            setTypeFilter('');
            setSelectedStatuses(publicStatuses.filter((status) => status !== 'Retired'));
            setSortBy('updated_desc');
          }}
        >
          Clear
        </Button>
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        Showing {visibleItems.length} of {items.length} public item(s)
      </p>

      {!hasItems && !error && (
        <div className="empty-state">
          <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
          <p>No public updates yet. Check back after an admin marks requests as visible.</p>
        </div>
      )}

      {hasItems && visibleItems.length > 0 && (
        <div className="public-list">
          {visibleItems.map((item) => (
            <article key={item.id} className="public-item">
              <div className="public-top">
                <strong>#{item.id}</strong>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Badge value={item.type} />
                  <Badge value={item.status} />
                </div>
              </div>
              <h4>{item.summary_of_issue || '-'}</h4>
              <div className="public-meta">
                <div className="pub-cols">
                  <div className="pub-col">
                    <div className="pub-field">
                      <span className="pub-label">Reported</span>
                      <span>{submittedDate(item.created_at)}</span>
                    </div>
                    <div className="pub-field">
                      <span className="pub-label">Policy / Account</span>
                      <span>{item.policy_num || '-'} / {item.account_num || '-'}</span>
                    </div>
                    <div className="pub-field">
                      <span className="pub-label">Latest Status</span>
                      <span>
                        {item.status === 'New'
                          ? 'Reported'
                          : item.status === 'Submitted'
                            ? 'Submitted to EV'
                            : (item.latest_status_value || item.status)
                        } on {statusDate(item.latest_status_changed_at)}
                      </span>
                    </div>
                    {item.status === 'Duplicate' && (
                      <div className="pub-field">
                        <span className="pub-label">Marked Duplicate</span>
                        <span>{statusDate(item.duplicate_status_at || item.latest_status_changed_at)}</span>
                      </div>
                    )}
                    {item.status === 'Retired' && !!item.retired_status_at && (
                      <div className="pub-field">
                        <span className="pub-label">Retired</span>
                        <span>{statusDate(item.retired_status_at)}</span>
                      </div>
                    )}
                  </div>
                  <div className="pub-col">
                    <div className="pub-field">
                      <span className="pub-label">Requestor</span>
                      <span>{item.created_by || '-'}</span>
                    </div>
                    <div className="pub-field">
                      <span className="pub-label">Application</span>
                      <span>{item.application_name || '-'}</span>
                    </div>
                    <div className="pub-field">
                      <span className="pub-label">EV Ticket</span>
                      <span>{item.easyvista_ticket_id || '-'}</span>
                    </div>
                    <div className="pub-field">
                      <span className="pub-label">JIRA Card #</span>
                      <span>{item.jira_number || '-'}</span>
                    </div>
                  </div>
                </div>
                <div className="pub-field pub-field-full">
                  <span className="pub-label">Description</span>
                  <span>{descriptionForItem(item)}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {hasItems && visibleItems.length === 0 && !error && (
        <div className="empty-state">
          <p>No items match your current search/filter settings.</p>
        </div>
      )}
    </>
  );
}
