import { useContext, useState } from 'react'
import { DocumentationItem } from '../documentation/types'
import { getDocumentationTypeIcon } from '../documentation/icons'
import { Action, ActionPanel, Icon, useNavigation } from '@raycast/api'
import DocumentationItemDetail from './DocumentationItemDetail'
import { DocumentationContext } from '../documentation/DocumentationContext'

type GotoSubmenuProps = {
  item: DocumentationItem
}

export function GotoSubmenu({ item }: GotoSubmenuProps) {
  const documentationContextValue = useContext(DocumentationContext)
  const { documentationList, documentationItemsMap } = documentationContextValue
  const { push } = useNavigation()
  const [itemsInScope, setItemsInScope] = useState<DocumentationItem[]>([])

  return (
    <ActionPanel.Submenu
      title="Go to"
      icon={Icon.Box}
      shortcut={{ modifiers: ['cmd'], key: 'p' }}
      onOpen={() => {
        const similarItems = []
        let targetForChildrenItem: DocumentationItem | undefined

        if (item.parentId != null) {
          const parentItemIdx = documentationItemsMap.get(item.parentId) ?? -1
          const parentItem = documentationList[parentItemIdx]

          if (parentItem) {
            targetForChildrenItem = parentItem
            similarItems.push(parentItem)
          }
        } else {
          targetForChildrenItem = item
        }

        if (targetForChildrenItem?.childrenIds) {
          for (const childId of targetForChildrenItem.childrenIds) {
            const childItemIdx = documentationItemsMap.get(childId) ?? -1
            const childItem = documentationList[childItemIdx]

            if (childItem && childItem.id !== item.id) {
              similarItems.push(childItem)
            }
          }
        }

        setItemsInScope(similarItems)
      }}
    >
      {itemsInScope.map((itemInScope) => (
        <Action
          key={itemInScope.id}
          title={itemInScope.name}
          icon={getDocumentationTypeIcon(itemInScope.type)}
          onAction={() => {
            push(
              <DocumentationContext value={documentationContextValue}>
                <DocumentationItemDetail item={itemInScope} />
              </DocumentationContext>
            )
          }}
        />
      ))}
    </ActionPanel.Submenu>
  )
}
