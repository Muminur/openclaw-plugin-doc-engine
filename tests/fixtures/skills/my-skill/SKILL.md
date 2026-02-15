# Crypto Tracker Skill

A skill for tracking cryptocurrency prices and portfolio performance.

## Usage

Invoke this skill when the user asks about cryptocurrency prices, market data, or portfolio tracking.

## Commands

### Check Price

```
/crypto price <symbol>
```

Returns the current price for the given cryptocurrency symbol (BTC, ETH, SOL, etc).

### Portfolio Summary

```
/crypto portfolio
```

Shows the user's portfolio with current values and profit/loss calculations.

## Implementation Notes

The skill uses the CoinGecko API for price data. Prices are cached for 60 seconds to avoid rate limiting.

### Rate Limits

- CoinGecko free tier: 10-30 calls/minute
- Cache TTL: 60 seconds
- Fallback: CoinMarketCap API

## Configuration

Add to your skill configuration:

```json
{
  "crypto-tracker": {
    "apiKey": "your-coingecko-api-key",
    "cacheTtl": 60,
    "defaultCurrency": "USD"
  }
}
```
