export class Metrics {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.startedAt = Date.now();
  }

  inc(name, labels = {}, value = 1) {
    const key = this.key(name, labels);
    const current = this.counters.get(key) || { name, labels, value: 0 };
    current.value += value;
    this.counters.set(key, current);
  }

  set(name, value, labels = {}) {
    this.gauges.set(this.key(name, labels), { name, labels, value });
  }

  observe(name, value) {
    let hist = this.histograms.get(name);
    if (!hist) {
      hist = {
        name,
        count: 0,
        sum: 0,
        buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
        bucketCounts: new Array(9).fill(0),
        max: 0,
      };
      this.histograms.set(name, hist);
    }
    hist.count += 1;
    hist.sum += value;
    if (value > hist.max) hist.max = value;
    for (let i = 0; i < hist.buckets.length; i += 1) {
      if (value <= hist.buckets[i]) {
        hist.bucketCounts[i] += 1;
        break;
      }
    }
  }

  key(name, labels) {
    const entries = Object.entries(labels || {}).sort(([a], [b]) => (a < b ? -1 : 1));
    if (!entries.length) return name;
    return `${name}{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
  }

  snapshot() {
    const counters = {};
    for (const [key, entry] of this.counters) counters[key] = entry.value;
    const gauges = {};
    for (const [key, entry] of this.gauges) gauges[key] = entry.value;
    const histograms = {};
    for (const [name, hist] of this.histograms) {
      histograms[name] = {
        count: hist.count,
        sum: Math.round(hist.sum * 100) / 100,
        avg: hist.count ? Math.round((hist.sum / hist.count) * 100) / 100 : 0,
        max: hist.max,
        buckets: Object.fromEntries(hist.buckets.map((b, i) => [b, hist.bucketCounts[i]])),
      };
    }
    return {
      uptimeMs: Date.now() - this.startedAt,
      counters,
      gauges,
      histograms,
    };
  }

  prometheus() {
    const lines = [];
    for (const entry of this.counters.values()) {
      lines.push(`brew_${entry.name}${fmtLabels(entry.labels)} ${entry.value}`);
    }
    for (const entry of this.gauges.values()) {
      lines.push(`brew_${entry.name}${fmtLabels(entry.labels)} ${entry.value}`);
    }
    for (const hist of this.histograms.values()) {
      let cumulative = 0;
      hist.buckets.forEach((bound, i) => {
        cumulative += hist.bucketCounts[i];
        lines.push(`brew_${hist.name}_bucket{le="${bound}"} ${cumulative}`);
      });
      lines.push(`brew_${hist.name}_sum ${hist.sum}`);
      lines.push(`brew_${hist.name}_count ${hist.count}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

function fmtLabels(labels) {
  const entries = Object.entries(labels || {});
  if (!entries.length) return '';
  return `{${entries.map(([k, v]) => `${k}="${v}"`).join(',')}}`;
}
