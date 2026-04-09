class URLs {
  private static readonly baseUrl = 'https://pcrghrjikkcmelflwiys.supabase.co/functions/v1';
  static readonly mcpFlow = `${this.baseUrl}/mcp-flow`;
  static readonly oauthInit = `${this.baseUrl}/oauth-init`;
  static readonly oauthExchange = `${this.baseUrl}/oauth-exchange`;
}

export default URLs;
