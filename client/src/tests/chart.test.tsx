import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FinancialChart from '../chart.tsx';

// Recharts uses ResizeObserver internally — polyfill for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe('FinancialChart', () => {
  it('renders nothing when rawData has no CHART_DATA tag', () => {
    const { container } = render(<FinancialChart rawData="some plain text response" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a chart container when valid CHART_DATA is present', () => {
    const raw = 'Here is your breakdown [CHART_DATA: {"Housing": 1200, "Food": 480}]';
    const { container } = render(<FinancialChart rawData={raw} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders a chart when CHART_DATA has a single category', () => {
    const raw = '[CHART_DATA: {"Housing": 1500}]';
    const { container } = render(<FinancialChart rawData={raw} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders a chart when CHART_DATA has many categories', () => {
    const raw = '[CHART_DATA: {"Housing": 1200, "Food": 400, "Transport": 150, "Entertainment": 60}]';
    const { container } = render(<FinancialChart rawData={raw} />);
    expect(container.firstChild).not.toBeNull();
  });
});
