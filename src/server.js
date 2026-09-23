require('dotenv').config();

const app = require('./app');

const PORT = process.env.PORT || 3000;

const runPricingCheck = async () => {
  if (typeof app.applyPriceRateLadder === 'function') {
    await app.applyPriceRateLadder();
  }
};

void runPricingCheck();

setInterval(() => {
  const now = new Date();
  if (now.getHours() === 11 && now.getMinutes() < 2) {
    void runPricingCheck();
  }
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`eBay Helper running at http://localhost:${PORT}`);
});
