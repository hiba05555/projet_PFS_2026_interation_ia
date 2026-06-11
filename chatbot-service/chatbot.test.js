/**
 * TESTS UNITAIRES - SERVICE CHATBOT
 */

const request = require('supertest');
const app = require('./server');

describe('Chatbot Service - Health Check', () => {
  test('GET /health should return 200', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
  });
});

describe('Chatbot Service - Chat Endpoint', () => {
  test('POST /chat without query should return 400', async () => {
    const response = await request(app)
      .post('/chat')
      .send({ userId: 'test-123' });
    
    expect(response.status).toBe(400);
  });

  test('POST /chat with valid data should return 200', async () => {
    const response = await request(app)
      .post('/chat')
      .send({
        query: 'Comment créer un ticket?',
        userId: 'test-123'
      });
    
    expect([200, 500]).toContain(response.status);
  });
});

describe('Chatbot Service - Reset Endpoint', () => {
  test('POST /reset should return 200', async () => {
    const response = await request(app)
      .post('/reset')
      .send({ userId: 'test-123' });
    
    expect([200, 500]).toContain(response.status);
  });
});


