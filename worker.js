// Amortization web worker — heavy schedule computation off the UI thread.
importScripts('lib/calc-engine.js');

self.onmessage = function (e) {
    const { id, type, payload } = e.data || {};
    try {
        let result;
        if (type === 'buildSchedule') {
            const { initialBalance, payment, annualRate, paymentsPerYear, amortYears, termYears } = payload;
            result = self.MortgageEngine.buildSchedule(initialBalance, payment, annualRate, paymentsPerYear, amortYears, termYears);
        } else if (type === 'simulateExtras') {
            const { initialBalance, payment, annualRate, paymentsPerYear, extraPerPayment, lumpSumPerYear, maxYears } = payload;
            result = self.MortgageEngine.simulateWithExtras(initialBalance, payment, annualRate, paymentsPerYear, extraPerPayment, lumpSumPerYear, maxYears);
        } else {
            throw new Error('Unknown message type: ' + type);
        }
        self.postMessage({ id, ok: true, result });
    } catch (err) {
        self.postMessage({ id, ok: false, error: err.message });
    }
};
