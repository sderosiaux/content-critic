// Base Prompt class
class Prompt {
  constructor(options = {}) {
    this.language = options.language || 'FRENCH';
    this.maxTokens = options.maxTokens || 20000;
    this.model = options.model || 'o4-mini';
  }

  // Abstract method that must be implemented by subclasses
  getPrompt() {
    throw new Error('getPrompt() must be implemented by subclass');
  }

  // Abstract method for response validation
  validateResponse(response) {
    throw new Error('validateResponse() must be implemented by subclass');
  }

  // Common method to format the final prompt with content
  formatWithContent(content) {
    return `${this.getPrompt()}\n\n${content}`;
  }

  // Abstract method for parsing raw API response
  parseResponse(rawResponse) {
    throw new Error('parseResponse() must be implemented by subclass');
  }

  // Common method to prepare API call options
  getApiCallOptions() {
    return {
      model: this.model,
      maxTokens: this.maxTokens
    };
  }
}

// Critic Prompt for content analysis
class CriticPrompt extends Prompt {
  constructor(options = {}) {
    super({
      ...options,
      maxTokens: options.maxTokens || 20000
    });
    this.validHighlightTypes = ['fluff', 'fallacy', 'assumption', 'contradiction', 'inconsistency'];
  }

  getPrompt() {
    return `You are a sharp, relentless content critic.
Your job is to break down any post, article, or idea I give you.

You do not summarize. You do not agree. You challenge.

You focus on:
- Uncovering assumptions (stated or hidden)
- Spotting contradictions or weak logic
- Testing ideas with second-order thinking, inversion, tradeoffs, and leverage analysis
- Surfacing what others miss: blind spots, sharper framings, edge opportunities

Ask hard questions like:
- What breaks this?
- What's assumed? What are the tradeoffs?
- What's a better wedge or leverage?
- If this is true, what becomes the next constraint?

Tone:
- No fluff. No praise unless it serves the analysis. Stay curious, sharp, and bold. Push thinking further.

Output rules: return ONLY a valid JSON object like this:
{
  "analysis": {
    "summary": "A 5-10 rows table (Markdown format) summary highlighting core premise, risks, effects, and tradeoffs",
    "critique": "Your detailed analysis and critique in markdown format using #, ##, ### for headers."
  },
  "highlights": [
    {
      "text": "EXACT QUOTE FROM THE CONTENT - Copy and paste the exact text you want to highlight, word for word",
      "type": "fluff|fallacy|assumption|contradiction|inconsistency",
      "explanation": "Your analysis of why this text is problematic",
      "suggestion": "Optional suggestion for improvement"
    }
  ]
}

CRITICAL RULES:
1. Return ONLY the JSON object, with no other text, it must be valid and complete
2. Do not include any markdown formatting outside of the JSON
3. Do not include any explanations or notes outside of the JSON
5. Each highlight's "text" field must be an EXACT quote from the content, NOT altered, NOT paraphrased, NOT summarized, NOT changed in any way.
6. Do not put your analysis in the "text" field - use the "explanation" field instead
7. Please generate minimum 5 and maximum 15 highlights. The more the better.
8. DO NOT wrap markdown tables or headers in 
9. Highlight types MUST only be one of: fluff|fallacy|assumption|contradiction|inconsistency.

Your answer must be in ${this.language}.
Please analyze and critique the following content:`;
  }

  validateResponse(response) {
    if (!response || typeof response !== 'object') {
      throw new Error('Response must be a JSON object');
    }

    if (!response.analysis || typeof response.analysis !== 'object') {
      throw new Error('Response must have an "analysis" object');
    }

    if (!response.analysis.summary || typeof response.analysis.summary !== 'string') {
      throw new Error('Analysis must have a "summary" string');
    }

    if (!response.analysis.critique || typeof response.analysis.critique !== 'string') {
      throw new Error('Analysis must have a "critique" string');
    }

    if (!Array.isArray(response.highlights)) {
      throw new Error('Response must have a "highlights" array');
    }

    if (response.highlights.length < 5 || response.highlights.length > 15) {
      //throw new Error('Response must have between 5 and 15 highlights');
    }

    response.highlights.forEach((highlight, index) => {
      if (!highlight || typeof highlight !== 'object') {
        throw new Error(`Highlight at index ${index} must be an object`);
      }

      if (!highlight.text || typeof highlight.text !== 'string') {
        throw new Error(`Highlight at index ${index} must have a "text" string`);
      }

      if (!highlight.type || typeof highlight.type !== 'string') {
        throw new Error(`Highlight at index ${index} must have a "type" string`);
      }

      if (!highlight.explanation || typeof highlight.explanation !== 'string') {
        throw new Error(`Highlight at index ${index} must have an "explanation" string`);
      }

      if (!this.validHighlightTypes.includes(highlight.type)) {
        throw new Error(`Highlight at index ${index} has invalid type "${highlight.type}". Must be one of: ${this.validHighlightTypes.join(', ')}`);
      }

      if (highlight.suggestion !== undefined && typeof highlight.suggestion !== 'string') {
        throw new Error(`Highlight at index ${index} must have a "suggestion" string if provided`);
      }
    });

    return true;
  }

  parseResponse(rawResponse) {
    // For critic prompts, we expect a JSON object
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No valid JSON object found in response for CRITIC task');
    }

    const parsedResult = JSON.parse(jsonMatch[0]);
    this.validateResponse(parsedResult); // Validate the parsed response

    return {
      analysis: parsedResult.analysis,
      highlights: parsedResult.highlights || []
    };
  }
}

// Critical Thinking Prompt for business analysis
class CriticalThinkingPrompt extends Prompt {
  constructor(options = {}) {
    super({
      ...options,
      maxTokens: options.maxTokens || 20000
    });
  }

  getPrompt() {
    return `<context>
    I'm making an important business decision and I want to think through it rigorously.
    The idea may relate to product strategy, market positioning, organizational design, or resource allocation.
    I want to avoid blind spots, weak assumptions, or strategic traps.
  </context>

  <role>
    Act as a strategic thought partner with the mindset of a skeptical investor, an experienced operator, and a rational analyst.
    Your job is not to agree with me. Your job is to make my thinking sharper and more grounded.
  </role>

  <instructions>
    Focus on clarity, business realism, and long-term consequences.
    Avoid buzzwords, generalities, or surface-level reactions.
    Think through the idea like you'd do if money, time, and reputation were on the line.
  </instructions>

  <structure>
    <step1>Restate the core idea in your own words to make sure it's coherent and well-framed.</step1>
    <step2>Identify implicit assumptions or areas I may be overlooking.</step2>
    <step3>Ask 3 to 5 sharp questions that would help me think more clearly or expose risks.</step3>
    <step4>Present strong counterpoints that someone skeptical would raise.</step4>
    <step5>Suggest alternative ways to reach the same goal, if this one has flaws.</step5>
    <step6>Give a quick clarity and focus check: does the idea feel crisp, grounded, and actionable?</step6>
  </structure>

  <tone>
    Direct, clear, analytical. No hedging. No polite filler. No vague encouragement.
  </tone>

Your answer must be in ${this.language}.
Please analyze and critique the following content:`;
  }

  validateResponse(response) {
    // For critical thinking, we expect a markdown formatted response
    if (typeof response !== 'string') {
      throw new Error('Response must be a string');
    }
    return true;
  }

  parseResponse(rawResponse) {
    // For critical thinking, we expect a markdown formatted string
    this.validateResponse(rawResponse); // Validate the raw response
    return {
      analysis: rawResponse
    };
  }
}

// HackerNews Prompt for comment analysis
class HackerNewsPrompt extends Prompt {
  constructor(options = {}) {
    super({
      ...options,
      maxTokens: options.maxTokens || 20000
    });
  }

  getPrompt() {
    return `Please provide a synthesis of the most important, opinionated, and surprising feedback from the HackerNews comments below. Additionally, you should highlight visionary ideas, mentions of competitors, identified opportunities, and raised challenges from the comments. 

Your response should be detailed, structured, and actionable, including concrete examples from the comments to provide valuable context.

Structure your analysis as follows:
- **Key Opinions & Surprising Takes**: Most thought-provoking viewpoints
- **Visionary Ideas**: Forward-thinking concepts and predictions  
- **Competitive Landscape**: Mentions of competitors, alternatives, comparisons
- **Opportunities**: Business, technical, or strategic opportunities identified
- **Challenges & Concerns**: Major issues, risks, and obstacles raised
- **Actionable Insights**: Concrete takeaways and next steps

Don't add comments before and after your analysis.
Answer using the markdown format only, using #, ##, ### for headers.
Each opinion should be a subtitle followed by some explanation.

Your answer must be in ${this.language}.
Here are the HackerNews comments to analyze:`;
  }

  validateResponse(response) {
    // For HackerNews, we expect a markdown formatted response
    if (typeof response !== 'string') {
      throw new Error('Response must be a string');
    }
    return true;
  }

  parseResponse(rawResponse) {
    // For HackerNews, we expect a markdown formatted string
    this.validateResponse(rawResponse); // Validate the raw response
    return {
      analysis: rawResponse
    };
  }
}

// Translation Prompt for translation tasks
class TranslationPrompt extends Prompt {
  constructor(options = {}) {
    super({
      ...options,
      maxTokens: options.maxTokens || 20000,
      model: options.model || 'gpt-4.1-mini'
    });
  }

  getPrompt() {
    return `You are a translator. Return a JSON object of ${this.language} translations.

FORMAT: {"t0":"translation0","t1":"translation1",...}

CRITICAL RULES:
1. Return ONLY a valid JSON object
2. Keep tech terms in English
3. Keep numbers/units unchanged
4. Remove unnecessary words only if that does not change the order of the translations
5. IMPORTANT: Each input key (t0, t1, etc.) MUST have exactly one translation
6. IMPORTANT: NEVER split a single input text into multiple translations
7. IMPORTANT: NEVER merge multiple input texts into one translation
8. IMPORTANT: Maintain the exact order of translations (t0, t1, t2, etc.)
9. IMPORTANT: Do not add or remove any keys
10. IMPORTANT: Each translation must be a complete, standalone translation of its input text
11. IMPORTANT: If an input text contains multiple sentences, keep them together in one translation

Example of CORRECT behavior:
Input: {"t0":"Hello world","t1":"API endpoint","t2":"Your enterprise data architecture is sprawling"}
Output: {"t0":"Bonjour le monde","t1":"API endpoint","t2":"Votre architecture de données d'entreprise est étendue"}

Example of INCORRECT behavior (DO NOT DO THIS):
Input: {"t0":"Your enterprise data architecture is sprawling"}
Output: {"t0":"Votre architecture de données","t1":"d'entreprise est étendue"}  // WRONG: split into two translations

Texts: `;
  }

  validateResponse(response) {
    try {
      const translations = typeof response === 'string' ? JSON.parse(response) : response;
      
      if (typeof translations !== 'object' || Array.isArray(translations)) {
        throw new Error('Response is not a JSON object');
      }

      // Validate each translation
      Object.entries(translations).forEach(([key, value]) => {
        if (!key.startsWith('t')) {
          throw new Error(`Invalid key format: ${key}. Keys must start with 't'`);
        }
        if (typeof value !== 'string') {
          throw new Error(`Translation for ${key} must be a string`);
        }
      });

      return true;
    } catch (error) {
      throw new Error(`Invalid translation response: ${error.message}`);
    }
  }

  parseResponse(rawResponse) {
    try {
      const translations = JSON.parse(rawResponse);
      this.validateResponse(translations);
      return { translations };
    } catch (e) {
      throw new Error('Invalid translation response format - ' + e.message);
    }
  }
}

// Suggestion Prompt for generating suggestions
class SuggestionPrompt extends Prompt {
  constructor(options = {}) {
    super({
      ...options,
      maxTokens: options.maxTokens || 20000
    });
  }

  getPrompt(analysisType, text, explanation, contextBefore = '', contextAfter = '') {
    return `En tant qu'expert en analyse de contenu, je te demande de suggérer une amélioration pour le texte suivant :

Type d'analyse: ${analysisType}

<previousContext>
${contextBefore}
</previousContext>

<textAnalyzed>
${text}
</textAnalyzed>

<followingContext>
${contextAfter}
</followingContext>

<currentExplanation>
${explanation}
</currentExplanation>

Peux-tu suggérer une amélioration ou une reformulation qui résoudrait le problème identifié (<currentExplanation>) ? 
La suggestion ne doit pas prendre plus de 500 caractères.
Prends en compte le contexte avant (previousContext) et après (followingContext) pour proposer une suggestion qui s'intègre naturellement dans le texte.
Réponds uniquement avec ton amélioration, sans explication supplémentaire.`;
  }

  validateResponse(response) {
    if (typeof response !== 'string') {
      throw new Error('Response must be a string');
    }
    if (response.length > 500) {
      throw new Error('Suggestion must not exceed 500 characters');
    }
    return true;
  }

  parseResponse(rawResponse) {
    // For suggestions, we expect a plain string
    this.validateResponse(rawResponse); // Validate the raw response
    return { suggestion: rawResponse.trim() };
  }
}

// Prompt Factory for creating and managing prompts
class PromptFactory {
  static createPrompt(type, options = {}) {
    switch (type.toLowerCase()) {
      case 'critic':
        return new CriticPrompt(options);
      case 'critical_thinking':
        return new CriticalThinkingPrompt(options);
      case 'hackernews':
        return new HackerNewsPrompt(options);
      case 'translation':
        return new TranslationPrompt(options);
      case 'suggestion':
        return new SuggestionPrompt(options);
      default:
        throw new Error(`Unknown prompt type: ${type}`);
    }
  }
}

// Export the classes
export {
  Prompt,
  CriticPrompt,
  CriticalThinkingPrompt,
  HackerNewsPrompt,
  TranslationPrompt,
  SuggestionPrompt,
  PromptFactory
}; 