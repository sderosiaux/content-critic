// Abstract base class for API clients
class ApiClient {
  constructor(options = {}) {
    this.model = options.model;
    this.apiKey = options.apiKey;
  }

  // Abstract method that must be implemented by subclasses
  async call(prompt, options = {}) {
    throw new Error('call() must be implemented by subclass');
  }

  // Common method to validate API key
  validateApiKey() {
    if (!this.apiKey) {
      throw new Error('API key is required');
    }
  }

  // Common method to prepare request body
  prepareRequestBody(prompt, options = {}) {
    return {
      model: this.model,
      //DO NOT USE//max_tokens: options.maxTokens || this.maxTokens,
      messages: this.prepareMessages(prompt, options)
    };
  }

  // Abstract method for message preparation
  prepareMessages(prompt, options) {
    throw new Error('prepareMessages() must be implemented by subclass');
  }

  // Common method to handle response
  handleResponse(response) {
    if (response.error) {
      throw new Error(response.error.message);
    }
    return this.extractRawResponse(response);
  }

  // Abstract method for extracting raw response
  extractRawResponse(response) {
    throw new Error('extractRawResponse() must be implemented by subclass');
  }
}

// Claude API client implementation
class ClaudeApiClient extends ApiClient {
  constructor(options = {}) {
    super({
      ...options,
      model: options.model || 'claude-3-sonnet-20240229'
    });
  }

  prepareMessages(prompt, options) {
    return [{
      role: 'user',
      content: prompt
    }];
  }

  async call(prompt, options = {}) {
    this.validateApiKey();

    const requestBody = this.prepareRequestBody(prompt, options);
    console.log('Claude API request:', requestBody);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    return this.handleResponse(data);
  }

  extractRawResponse(response) {
    return response.content[0].text;
  }
}

// OpenAI API client implementation
class OpenAiApiClient extends ApiClient {
  constructor(options = {}) {
    super({
      ...options,
      model: options.model || 'o4-mini'
    });
  }

  prepareMessages(prompt, options) {
    if (options.isTranslation) {
      return [
        {
          role: 'system',
          content: 'You are a translator. You MUST return a valid JSON object of translations. Do not include any other text in your response.'
        },
        {
          role: 'user',
          content: prompt
        }
      ];
    }
    return [{
      role: 'user',
      content: prompt
    }];
  }

  async call(prompt, options = {}) {
    this.validateApiKey();

    const requestBody = {
      ...this.prepareRequestBody(prompt, options),
      response_format: options.isTranslation ? { type: "json_object" } : undefined
    };
    console.log('OpenAI API request:', requestBody);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    return this.handleResponse(data);
  }

  extractRawResponse(response) {
    return response.choices[0].message.content;
  }
}

// Factory for creating API clients
class ApiClientFactory {
  static createClient(apiKey, options = {}) {
    if (apiKey.startsWith('sk-ant-')) {
      return new ClaudeApiClient({ ...options, apiKey });
    } else {
      return new OpenAiApiClient({ ...options, apiKey });
    }
  }
}

export {
  ApiClient,
  ClaudeApiClient,
  OpenAiApiClient,
  ApiClientFactory
}; 