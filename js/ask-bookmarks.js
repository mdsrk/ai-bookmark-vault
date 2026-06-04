// ============================================================
// Ask My Bookmarks — Conversational Q&A
// ============================================================

const CHAT_HISTORY_KEY = 'vault_chat_history';
const MAX_HISTORY = 5;

/**
 * Get chat history from sessionStorage.
 */
function getChatHistory() {
  try {
    return JSON.parse(sessionStorage.getItem(CHAT_HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

/**
 * Save chat history to sessionStorage.
 */
function saveChatHistory(history) {
  sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(history));
}

/**
 * Add a message to the chat UI.
 */
function addChatMessage(content, role, citations = []) {
  const chatArea = document.getElementById('chatMessages');
  const emptyEl = document.getElementById('chatEmpty');
  if (emptyEl) emptyEl.style.display = 'none';

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${role}`;

  if (role === 'ai') {
    // Process content to add citation pills
    let html = escapeHtml(content);

    // Replace citation markers [Title] with clickable pills
    if (citations && citations.length > 0) {
      for (const cite of citations) {
        const escapedCite = escapeRegex(cite);
        const regex = new RegExp(`\\[${escapedCite}\\]`, 'g');
        html = html.replace(regex, (match) => {
          return `<a href="#" class="citation-pill" onclick="return false;"><i class="fas fa-bookmark mr-1"></i>${escapeHtml(cite)}</a>`;
        });
      }
    }

    msgDiv.innerHTML = html;
  } else {
    msgDiv.textContent = content;
  }

  chatArea.appendChild(msgDiv);
  chatArea.scrollTop = chatArea.scrollHeight;
}

/**
 * Show typing indicator.
 */
function showTypingIndicator() {
  const chatArea = document.getElementById('chatMessages');
  const indicator = document.createElement('div');
  indicator.className = 'chat-message ai';
  indicator.id = 'typingIndicator';
  indicator.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  chatArea.appendChild(indicator);
  chatArea.scrollTop = chatArea.scrollHeight;
}

/**
 * Remove typing indicator.
 */
function removeTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

/**
 * Send a question to the AI.
 */
async function sendQuestion() {
  const input = document.getElementById('chatInput');
  const question = input.value.trim();
  const bannerEl = document.getElementById('askNotConfiguredBanner');

  if (!question) return;

  // Add user message
  addChatMessage(question, 'user');
  input.value = '';

  // Show typing indicator
  showTypingIndicator();

  try {
    const history = getChatHistory();
    const data = await apiCall('/api/ask', 'POST', {
      question,
      history: history.slice(-MAX_HISTORY),
    });

    removeTypingIndicator();

    // Add AI response
    addChatMessage(data.answer, 'ai', data.citations || []);

    // Save to history
    history.push({ question, answer: data.answer });
    saveChatHistory(history);
  } catch (err) {
    removeTypingIndicator();

    if (err.code === 'AI_NOT_CONFIGURED') {
      bannerEl.style.display = 'block';
      return;
    }

    addChatMessage(
      err.message || 'Sorry, I encountered an error. Please try again.',
      'ai'
    );
  }
}

/**
 * Clear conversation.
 */
function clearConversation() {
  const chatArea = document.getElementById('chatMessages');
  const emptyEl = document.getElementById('chatEmpty');

  // Keep only the empty state
  chatArea.innerHTML = '';
  if (emptyEl) {
    emptyEl.style.display = 'block';
    chatArea.appendChild(emptyEl);
  }

  sessionStorage.removeItem(CHAT_HISTORY_KEY);
}

/**
 * Setup Ask handlers.
 */
function setupAskBookmarks() {
  const sendBtn = document.getElementById('chatSendBtn');
  const input = document.getElementById('chatInput');
  const clearBtn = document.getElementById('chatClearBtn');

  if (!sendBtn || !input) return;

  sendBtn.addEventListener('click', sendQuestion);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuestion();
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', clearConversation);
  }
}
