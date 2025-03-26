// utils.js

async function retryWithBackoff(fn, retries = 5, delay = 1000, factor = 2) {
    let attempt = 0;
    let currentDelay = delay;
  
    while (attempt < retries) {
      try {
        return await fn();
      } catch (error) {
        const isRetryable =
          error.code === 'ECONNRESET' ||
          error.code === 'ENOTFOUND' ||
          error.response?.status >= 500;
  
        if (!isRetryable) throw error;
  
        console.warn(`[RETRY ${attempt + 1}] Retrying in ${currentDelay}ms due to: ${error.message || error.code}`);
        await new Promise((res) => setTimeout(res, currentDelay));
        currentDelay *= factor;
        attempt++;
      }
    }
  
    throw new Error(`Failed after ${retries} retries`);
  }
  
  module.exports = {
    retryWithBackoff
  };
  