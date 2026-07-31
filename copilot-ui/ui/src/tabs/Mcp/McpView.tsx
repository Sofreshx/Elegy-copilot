import { PageContainer, Panel, Toolbar } from '../../components';

export default function McpView() {
  return (
    <div className="view-shell mcp-view" data-testid="mcp-view">
      <div className="view-static">
        <Toolbar testId="mcp-toolbar"><h2>MCP</h2></Toolbar>
      </div>
      <div className="view-scroll">
        <PageContainer>
          <Panel
            title="MCP Providers"
            subtitle="No local MCP providers are configured."
            testId="mcp-providers"
          >
            <p className="catalog-inline-note">
              Add provider integrations through their supported plugin or connector.
            </p>
          </Panel>
        </PageContainer>
      </div>
    </div>
  );
}
