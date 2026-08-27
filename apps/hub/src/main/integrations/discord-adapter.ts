import { Client, GatewayIntentBits } from "discord.js";

export class DiscordAdapter {
  private client: Client | null = null;

  public constructor(private config: { token?: string; channelId?: string }) {}

  public get enabled(): boolean {
    return Boolean(this.config.token);
  }

  public async start(): Promise<void> {
    if (!this.config.token || this.client) return;
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await client.login(this.config.token);
    this.client = client;
  }

  public async stop(): Promise<void> {
    this.client?.destroy();
    this.client = null;
  }

  public async configure(config: { token?: string; channelId?: string }): Promise<void> {
    await this.stop();
    this.config = config;
    if (config.token) await this.start();
  }

  public async testConnection(): Promise<string> {
    if (!this.client || !this.config.channelId) throw new Error("Discord integration or channel is not configured");
    const channel = await this.client.channels.fetch(this.config.channelId);
    if (!channel?.isSendable()) throw new Error(`Discord channel '${this.config.channelId}' is not sendable`);
    return `Channel ${channel.id}`;
  }

  public async testChannel(channelId: string): Promise<string> {
    const id = (channelId ?? "").trim();
    if (!this.client || !id) throw new Error("Discord integration or channel is not configured");
    const channel = await this.client.channels.fetch(id);
    if (!channel?.isSendable()) throw new Error(`Discord channel '${id}' is not sendable`);
    return `Channel ${channel.id}`;
  }

  public async sendMessage(content: string, channelId = this.config.channelId): Promise<string> {
    if (!this.client || !channelId) throw new Error("Discord integration or channel is not configured");
    const channel = await this.client.channels.fetch(channelId);
    if (!channel?.isSendable()) throw new Error(`Discord channel '${channelId}' is not sendable`);
    const sent = await channel.send({ content: trimDiscord(content) });
    return sent.id;
  }
}

function trimDiscord(content: string): string {
  if (content.length <= 2_000) return content;
  return `${content.slice(0, 1_980)}\n…(truncated)`;
}
