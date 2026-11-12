export interface ExampleApp {
  name: string
  port: number
  output: string
  integration: string
  npmFlags?: string[]
}
export const APPS: ExampleApp[]
export const COLLECTOR: string
export const SITE_KEY: string
