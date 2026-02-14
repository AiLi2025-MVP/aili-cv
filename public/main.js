const observerOptions = {
  threshold: 0.15,
  rootMargin: '0px 0px -80px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('active');
    }
  });
}, observerOptions);

document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', (event) => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

const apiBase = document.body?.dataset?.apiBase || '/api';
const form = document.getElementById('contact-form');
const feedbackEl = document.getElementById('contact-feedback');

async function submitInquiry(event) {
  event.preventDefault();
  if (!form) return;
  const submitBtn = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const payload = {
    name: formData.get('name')?.trim(),
    email: formData.get('email')?.trim(),
    organization: formData.get('organization')?.trim(),
    phone: formData.get('phone')?.trim(),
    message: formData.get('message')?.trim(),
    city: formData.get('city')?.trim()
  };

  if (payload.city) {
    // Honeypot triggered
    form.reset();
    return;
  }

  if (!payload.name || !payload.email || !payload.message) {
    showFeedback('Please complete the required fields before sending.', false);
    return;
  }

  toggleSubmitting(submitBtn, true);
  showFeedback('Sending your private brief…', true);

  try {
    const endpoint = `${apiBase.replace(/\/$/, '')}/inquiry`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    if (response.ok && data?.success) {
      form.reset();
      showFeedback('Received. Expect a discreet reply shortly.', true);
    } else {
      const message = data?.message || 'Something went wrong. Please retry or email directly.';
      showFeedback(message, false);
    }
  } catch (error) {
    showFeedback('Network issue. Email lateef@theaili.com directly.', false);
  } finally {
    toggleSubmitting(submitBtn, false);
  }
}

function toggleSubmitting(button, isSubmitting) {
  if (!button) return;
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent.trim();
  }
  button.disabled = isSubmitting;
  button.textContent = isSubmitting ? 'Sending…' : button.dataset.defaultLabel;
}

function showFeedback(message, isSuccess) {
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  feedbackEl.dataset.state = isSuccess ? 'success' : 'error';
}

if (form) {
  form.addEventListener('submit', submitInquiry);
}
