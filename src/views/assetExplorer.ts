import * as vscode from 'vscode';

export class AssetExplorerProvider implements vscode.TreeDataProvider<AssetItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AssetItem | undefined | void> = new vscode.EventEmitter<AssetItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<AssetItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor() {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AssetItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: AssetItem): Thenable<AssetItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return Promise.resolve([
                new AssetItem('Projects', vscode.TreeItemCollapsibleState.Collapsed, 'folder'),
                new AssetItem('Users', vscode.TreeItemCollapsibleState.Collapsed, 'folder')
            ]);
        }
    }
}

class AssetItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string
    ) {
        super(label, collapsibleState);
        this.iconPath = contextValue === 'folder' 
            ? new vscode.ThemeIcon('folder') 
            : new vscode.ThemeIcon('file-code');
    }
}
