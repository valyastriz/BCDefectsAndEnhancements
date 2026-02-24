async function submitToEasyVista(submission) {
  const baseUrl = process.env.EASYVISTA_BASE_URL;
  const apiToken = process.env.EASYVISTA_API_KEY;

  if (!baseUrl || !apiToken) {
    const suffix = String(Math.floor(10000 + Math.random() * 89999));
    return {
      ticketId: `EV-${suffix}`,
      source: 'stub',
    };
  }

  const description = [
    `Type: ${submission.type}`,
    `Application: ${submission.application_name}`,
    `Created By: ${submission.created_by} (${submission.created_by_email})`,
    `Policy #: ${submission.policy_num || 'N/A'}`,
    `Account #: ${submission.account_num || 'N/A'}`,
    `Transaction #: ${submission.transaction_num || 'N/A'}`,
    `Screen Title: ${submission.screen_title}`,
    `Date/Time of Error: ${submission.date_time_of_error}`,
    `Desired Completion Date: ${submission.desired_completion_date || 'N/A'}`,
    `Enhancement Request Type: ${submission.enhancement_request_type || 'N/A'}`,
    `Priority Level: ${submission.priority_level || 'N/A'}`,
    `Jira Number: ${submission.jira_number || 'N/A'}`,
    '',
    'Summary:',
    submission.summary_of_issue,
    '',
    'Steps to Reproduce:',
    submission.steps_to_reproduce,
    '',
    'What Happened (Exact Details):',
    submission.what_happened_exact_details,
    '',
    'Request:',
    submission.request,
    '',
    'Impact Details:',
    submission.impact_details || 'N/A',
  ].join('\n');

  const payload = {
    title: submission.summary_of_issue,
    description,
    metadata: {
      submissionId: submission.id,
      status: submission.status,
      fingerprint: submission.fingerprint,
    },
  };

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/tickets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`EasyVista API request failed: ${response.status} ${message}`);
  }

  const data = await response.json();
  const ticketId = data.ticketId || data.incidentNumber || data.requestNumber;

  if (!ticketId) {
    throw new Error('EasyVista API response did not include a ticket identifier');
  }

  return {
    ticketId,
    source: 'api',
  };
}

module.exports = {
  submitToEasyVista,
};
