// Popup script: UI, fetch friends, handle rate limiting/backoff, display results.

const DOM = {
  scanPageBtn: document.getElementById('scan-page'),
  scanIdBtn: document.getElementById('scan-id'),
  manualIdInput: document.getElementById('manual-id'),
  thresholdInput: document.getElementById('threshold'),
  maxAgeInput: document.getElementById('max-age'),
  status: document.getElementById('status'),
  list: document.getElementById('list'),
  count: document.getElementById('count')
};

const DEFAULTS = { threshold: 3, maxAgeYears: 0 };

// Utility: sleep
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function playDoneSound() {
  const ctx = new AudioContext();
  const response = await fetch(browser.runtime.getURL("assets/finished.wav"));
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  source.start(0);
}

// Rate-limited fetch with basic exponential backoff for 429/5xx
async function safeFetch(url, opts={}, attempt=0){
  const maxAttempts = 6;
  try{
    const res = await fetch(url, opts);
    if (res.status === 429 || (res.status >=500 && res.status <600)){
      if (attempt < maxAttempts){
        const backoff = Math.pow(2, attempt) * 500 + Math.random()*200;
        await sleep(backoff);
        return safeFetch(url, opts, attempt+1);
      }
    }
    return res;
  }catch(e){
    if (attempt < maxAttempts){
      await sleep(500 * Math.pow(2, attempt));
      return safeFetch(url, opts, attempt+1);
    }
    throw e;
  }
}

// Fetch friends of a user (paginated). Uses friends.roblox.com API.
async function fetchAllFriends(userId){
  const pageSize = 100;
  let cursor = null;
  let all = [];
  while(true){
    const url = new URL(`https://friends.roblox.com/v1/users/${userId}/friends`);
    url.searchParams.set('limit', pageSize);
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await safeFetch(url.toString(), { method:'GET', credentials: 'omit' });
    if (!res.ok){
      throw new Error(`Failed to fetch friends: ${res.status}`);
    }
    const data = await res.json();
    if (Array.isArray(data.data)){
      all = all.concat(data.data);
    }
    if (!data.nextPageCursor) break;
    cursor = data.nextPageCursor;
    // Small delay to reduce chances of rate-limit
    await sleep(200);
  }
  return all; // each item has id, name
}

// Fetch user details (to get created date or friend count). We'll fetch minimal fields
async function fetchUser(userId){
  const url = `https://users.roblox.com/v1/users/${userId}`;
  const res = await safeFetch(url, { method:'GET', credentials:'omit' });
  if (!res.ok) throw new Error(`Failed to fetch user ${userId}: ${res.status}`);
  return res.json();
}

// Fetch user's friend count
async function fetchFriendCount(userId){
  const url = `https://friends.roblox.com/v1/users/${userId}/friends/count`;
  const res = await safeFetch(url, { method:'GET', credentials:'omit' });
  if (!res.ok) throw new Error(`Failed to fetch friend count for ${userId}: ${res.status}`);
  const j = await res.json();
  return j.count;
}

// Convert created date string to age in years
function yearsBetween(dateString){
  const created = new Date(dateString);
  const now = new Date();
  const diff = now - created;
  return diff / (1000 * 60 * 60 * 24 * 365.25);
}

function setStatus(txt){ DOM.status.textContent = txt; }

function clearResults(){ DOM.list.innerHTML = ''; DOM.count.textContent = '0'; }

function addResult(item){
  const div = document.createElement('div');
  div.className = 'item';
  div.innerHTML = `<div><strong><a href="https://www.roblox.com/users/${item.id}/profile" target="_blank" rel="noopener">${item.name}</a></strong> (#${item.id})</div>`;
  if (item.friendCount !== undefined) div.innerHTML += `<div style="font-size:12px;color:#666">Friends: ${item.friendCount}</div>`;
  if (item.ageYears !== undefined) div.innerHTML += `<div style="font-size:12px;color:#666">Age: ${item.ageYears.toFixed(2)} years</div>`;
  DOM.list.appendChild(div);
  DOM.count.textContent = Number(DOM.count.textContent) + 1;
}

async function scanFriendsOf(userId, options){
  setStatus('Fetching friends...');
  clearResults();
  try{
    const friends = await fetchAllFriends(userId);
    setStatus(`Found ${friends.length} friends — checking each...`);

    // Process sequentially with small delay
    for (let i=0;i<friends.length;i++){
      const f = friends[i];
      setStatus(`Checking ${i+1}/${friends.length}: ${f.name}`);
      let friendCount = null;
      let userInfo = null;
      try{
        friendCount = await fetchFriendCount(f.id);
      }catch(e){
        console.warn('friend count failed for', f.id, e);
      }

      if (friendCount !== null && friendCount >= options.threshold) {
        // doesn't qualify
      } else {
        let qualifies = true;
        if (options.maxAgeYears > 0){
          try{
            userInfo = await fetchUser(f.id);
            const age = yearsBetween(userInfo.created);
            if (age > options.maxAgeYears) qualifies = false;
            f.ageYears = age;
          }catch(e){
            console.warn('failed to get user info for age', f.id, e);
            qualifies = false;
          }
        }
        if (friendCount === null && options.threshold > 0){ qualifies = false; }
        if (qualifies){
          f.friendCount = friendCount;
          addResult(f);
        }
      }
      await sleep(150);
    }

    setStatus('Scan complete');
  }catch(err){
    console.error(err);
    setStatus('Error: '+(err.message||err));
  }
}

async function getUserIdFromPage(){
  const tabs = await browser.tabs.query({ active:true, currentWindow:true });
  const tab = tabs[0];
  if (!tab) return null;
  try{
    const results = await browser.tabs.executeScript(tab.id, {
      code: `(function(){
        const el = document.documentElement;
        if (el && el.dataset && el.dataset.robloxUserId) return el.dataset.robloxUserId;
        const m = location.href.match(/\\/users\\/(\\d+)\\/profile/);
        return m?m[1]:null;
      })()`
    });
    return results && results[0] ? results[0] : null;
  }catch(e){
    console.warn('executeScript failed', e);
    return null;
  }
}

// Event handlers
DOM.scanPageBtn.addEventListener('click', async ()=>{
  setStatus('Locating user on page...');
  const uid = await getUserIdFromPage();
  if (!uid){ setStatus('No Roblox user detected on the current tab.'); return; }
  const threshold = Number(DOM.thresholdInput.value) || DEFAULTS.threshold;
  const maxAge = Number(DOM.maxAgeInput.value) || DEFAULTS.maxAgeYears;
  await scanFriendsOf(uid, { threshold, maxAgeYears: maxAge });
});

DOM.scanIdBtn.addEventListener('click', async ()=>{
  const uid = DOM.manualIdInput.value.trim();
  if (!uid || !/^\\d+$/.test(uid)){ setStatus('Enter a numeric user ID'); return; }
  const threshold = Number(DOM.thresholdInput.value) || DEFAULTS.threshold;
  const maxAge = Number(DOM.maxAgeInput.value) || DEFAULTS.maxAgeYears;
  await scanFriendsOf(uid, { threshold, maxAgeYears: maxAge });
});

// Restore saved settings
async function loadSettings(){
  const s = await browser.storage.local.get(['threshold','maxAge']);
  if (s.threshold !== undefined) DOM.thresholdInput.value = s.threshold;
  if (s.maxAge !== undefined) DOM.maxAgeInput.value = s.maxAge;
}

// Save settings on change
DOM.thresholdInput.addEventListener('change', ()=>{
  const v = Number(DOM.thresholdInput.value);
  browser.storage.local.set({ threshold: v });
});
DOM.maxAgeInput.addEventListener('change', ()=>{
  const v = Number(DOM.maxAgeInput.value);
  browser.storage.local.set({ maxAge: v });
});

loadSettings();
