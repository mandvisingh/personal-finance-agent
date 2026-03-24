import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.tsx';

// Recharts ResizeObserver polyfill
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// crypto.randomUUID is available in Node 18+ but not in jsdom — stub it
Object.defineProperty(global, 'crypto', {
  value: { randomUUID: () => 'test-thread-id' },
});

// Stub fetch — default to a successful empty response
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ text: 'Hello from the bot!', profile: { salary: null, currentSavings: null, goals: null } }),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Initial render
// ─────────────────────────────────────────────────────────────────────────────
describe('App — initial render', () => {
  it('renders without crashing', () => {
    render(<App />);
  });

  it('shows the welcome message on load', () => {
    render(<App />);
    expect(screen.getByText(/Personal Finance Analyst/i)).toBeInTheDocument();
  });

  it('renders the FinanceAI brand in the sidebar', () => {
    render(<App />);
    expect(screen.getByText('FinanceAI')).toBeInTheDocument();
  });

  it('shows dashes for all profile fields when profile is empty', () => {
    render(<App />);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2); // income + savings + goals (goals shows —)
  });

  it('renders the message input', () => {
    render(<App />);
    expect(screen.getByPlaceholderText(/Message your finance agent/i)).toBeInTheDocument();
  });

  it('send button is disabled when input is empty', () => {
    render(<App />);
    // Input is empty — send button should be disabled
    const input = screen.getByPlaceholderText(/Message your finance agent/i);
    expect(input).toHaveValue('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sending a message
// ─────────────────────────────────────────────────────────────────────────────
describe('App — sending a message', () => {
  it('displays the user message in the chat after sending', async () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/Message your finance agent/i);

    await userEvent.type(input, 'My salary is $5000');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('My salary is $5000')).toBeInTheDocument();
  });

  it('calls the chat API with the correct threadId and message', async () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/Message your finance agent/i);

    await userEvent.type(input, 'hello');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/chat');
    const body = JSON.parse(options.body);
    expect(body.threadId).toBe('test-thread-id');
    expect(body.messages.at(-1).content).toBe('hello');
  });

  it('displays the bot reply in the chat', async () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/Message your finance agent/i);

    await userEvent.type(input, 'hi');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => screen.getByText('Hello from the bot!'));
    expect(screen.getByText('Hello from the bot!')).toBeInTheDocument();
  });

  it('clears the input field after sending', async () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/Message your finance agent/i);

    await userEvent.type(input, 'test message');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('shows an error message when the API call fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Service unavailable' }),
    });

    render(<App />);
    const input = screen.getByPlaceholderText(/Message your finance agent/i);

    await userEvent.type(input, 'hi');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => screen.getByText('Service unavailable'));
    expect(screen.getByText('Service unavailable')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Profile sidebar
// ─────────────────────────────────────────────────────────────────────────────
describe('App — profile sidebar', () => {
  it('updates the sidebar when the API returns a profile', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        text: "Got it! I've saved your salary.",
        profile: { salary: 5000, currentSavings: null, goals: null },
      }),
    });

    render(<App />);
    const input = screen.getByPlaceholderText(/Message your finance agent/i);

    await userEvent.type(input, 'my salary is 5000');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => screen.getByText('$5,000'));
    expect(screen.getByText('$5,000')).toBeInTheDocument();
  });

  it('shows "Profile active" badge when any profile field is set', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        text: 'Saved.',
        profile: { salary: 3000, currentSavings: null, goals: null },
      }),
    });

    render(<App />);
    const input = screen.getByPlaceholderText(/Message your finance agent/i);
    await userEvent.type(input, 'salary 3000');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => screen.getByText(/Profile active/i));
    expect(screen.getByText(/Profile active/i)).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PDF upload validation
// ─────────────────────────────────────────────────────────────────────────────
describe('App — PDF upload validation', () => {
  it('shows an error when a non-PDF file is selected', async () => {
    render(<App />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    // userEvent.upload respects the accept attribute and skips non-matching files,
    // so use fireEvent.change to directly test the component's own type validation.
    const txtFile = new File(['content'], 'document.txt', { type: 'text/plain' });
    Object.defineProperty(fileInput, 'files', { value: [txtFile], configurable: true });
    fireEvent.change(fileInput);

    expect(screen.getByText(/Only PDF files are supported/i)).toBeInTheDocument();
  });

  it('shows an error when a PDF over 10MB is selected', async () => {
    render(<App />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    const bigPdf = new File([new ArrayBuffer(11 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' });
    await userEvent.upload(fileInput, bigPdf);

    expect(screen.getByText(/PDF must be under 10MB/i)).toBeInTheDocument();
  });

  it('shows a PDF pill when a valid PDF is selected', async () => {
    render(<App />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    const validPdf = new File(['%PDF-1.4 content'], 'statement.pdf', { type: 'application/pdf' });
    await userEvent.upload(fileInput, validPdf);

    await waitFor(() => screen.getByText('statement.pdf'));
    expect(screen.getByText('statement.pdf')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// New conversation
// ─────────────────────────────────────────────────────────────────────────────
describe('App — new conversation', () => {
  it('"+ New conversation" button clears the chat', async () => {
    render(<App />);
    const input = screen.getByPlaceholderText(/Message your finance agent/i);

    await userEvent.type(input, 'first message');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => screen.getByText('first message'));

    const newChatBtn = screen.getByText('+ New conversation');
    await userEvent.click(newChatBtn);

    expect(screen.queryByText('first message')).not.toBeInTheDocument();
  });
});
