import { showToast } from '../components/Toast.js';

// The frontend and API are deployed together. A relative base keeps requests on the current
// Vercel/custom domain and avoids cross-origin cookie and CORS failures.
export const API_BASE_URL = '/api';

/**
 * Universal apiFetch helper for production backend integration
 * Handles headers, JSON serialization/deserialization, credentials, and global error toasts.
 */
export async function apiFetch(endpoint, method = 'GET', payload = null) {
  // Normalize endpoint URL (handles relative or full API_BASE_URL paths)
  let url = endpoint;
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    url = `${API_BASE_URL}${cleanEndpoint}`;
  }

  const options = {
    method: method.toUpperCase(),
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    credentials: 'include' // Sends the HTTP-only session cookie on same-origin requests.
  };

  if (payload && (options.method === 'POST' || options.method === 'PUT' || options.method === 'PATCH')) {
    options.body = JSON.stringify(payload);
  }

  try {
    const response = await fetch(url, options);
    let data;

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = { message: await response.text() };
    }

    if (!response.ok) {
      const errorMessage = data?.error || data?.message || `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(errorMessage);
    }

    return data;
  } catch (error) {
    console.error(`❌ [API FETCH ERROR] ${method} ${url}:`, error);
    
    // Trigger Global Error Toast notification
    showToast(error.message || 'Failed to connect to backend server', 'error');
    throw error;
  }
}

/**
 * Attaches production-ready API submit listeners to forms with button loading spinners & navigation
 */
export function setupFormApiHandler(formId, endpoint, method = 'POST', onSuccess = null) {
  const form = document.getElementById(formId);
  if (!form) return;

  // Prevent multiple listeners
  if (form.getAttribute('data-api-wired') === 'true') return;
  form.setAttribute('data-api-wired', 'true');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <span class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></span>
        <span>Processing...</span>
      `;
    }

    try {
      const formData = new FormData(form);
      const payload = {};

      for (let [key, value] of formData.entries()) {
        if (key.endsWith('[]')) {
          const cleanKey = key.replace('[]', '');
          if (!payload[cleanKey]) payload[cleanKey] = [];
          payload[cleanKey].push(value);
        } else if (payload[key]) {
          if (!Array.isArray(payload[key])) payload[key] = [payload[key]];
          payload[key].push(value);
        } else {
          payload[key] = value;
        }
      }

      console.log(`🚀 [SUBMITTING FORM] ${method} ${endpoint}`, payload);

      const result = await apiFetch(endpoint, method, payload);
      
      showToast(result?.message || 'Submitted successfully!', 'success');

      if (typeof onSuccess === 'function') {
        onSuccess(result, payload);
      }
    } catch (err) {
      // Error handled by global apiFetch toast
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  });
}
