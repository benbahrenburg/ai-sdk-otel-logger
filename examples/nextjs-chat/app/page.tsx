'use client';

import { useChat } from '@ai-sdk/react';

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat();

  return (
    <div
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: '2rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
      }}
    >
      <h1 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
        AI SDK OTel Plugin Demo
      </h1>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 8,
              background: m.role === 'user' ? '#e8f0fe' : '#f1f3f5',
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
            }}
          >
            <strong>{m.role === 'user' ? 'You' : 'Assistant'}:</strong>{' '}
            {m.content}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Ask something..."
          disabled={isLoading}
          style={{
            flex: 1,
            padding: '0.75rem',
            border: '1px solid #ccc',
            borderRadius: 8,
            fontSize: '1rem',
          }}
        />
        <button
          type="submit"
          disabled={isLoading}
          style={{
            padding: '0.75rem 1.5rem',
            background: '#0070f3',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
