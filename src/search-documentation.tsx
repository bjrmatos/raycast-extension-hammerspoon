import assert from 'node:assert/strict'
import fsPromise from 'node:fs/promises'
import { ActionPanel, Detail, List, Action, Color } from '@raycast/api'
import { runAppleScript, useCachedPromise, useCachedState } from '@raycast/utils'
import { useMemo } from 'react'
import path from 'node:path'

const defaultSource = { name: 'All Sources', path: '*' }

export default function main() {
  const [selectedSource, setSelectedSource] = useCachedState<SourceItem>('selected-source', defaultSource)

  const {
    isLoading,
    data: documentationRepository
    // revalidate: revalidateDocs
  } = useCachedPromise(
    async (): Promise<DocumentationRepository> => {
      // we get all files and built in files separately because
      // technically user may unregister json files with `hs.doc.unregisterJSONFile`
      const output = await runAppleScript(
        `
        tell application "Hammerspoon"
          execute lua code "
            hs.json.encode({
              builtInFiles = {
                hs.docstrings_json_file,
                hs.docstrings_json_file:gsub('/docs.json$', '/lua.json')
              },
              allFiles = hs.doc.registeredFiles()
            })
          "
        end tell
      `
      )

      const docsInfo = JSON.parse(output)
      const result = await extractDocumentationFromDocsFiles(docsInfo)
      return result
    },
    [],
    {
      initialData: {
        sourceList: [],
        sourceToDocumentationRangeEntries: [],
        documentationList: [],
        documentationItemsEntries: []
      } as DocumentationRepository,
      failureToastOptions: {
        title: "Couldn't resolve documentation files of Hammerspoon"
      }
    }
  )

  const sourceToDocumentationRangeMap = useMemo(() => {
    return new Map(documentationRepository.sourceToDocumentationRangeEntries)
  }, [documentationRepository])

  const documentationItemsMap = useMemo(() => {
    return new Map(documentationRepository.documentationItemsEntries)
  }, [documentationRepository])

  const sourceDropdownItems = useMemo(() => {
    const files: SourceItem[] = [defaultSource]
    files.push(...documentationRepository.sourceList)
    return files
  }, [documentationRepository])

  const groups = useMemo(() => {
    const result = []

    for (const [sourcePath, range] of sourceToDocumentationRangeMap.entries()) {
      const selectedSourceItem = documentationRepository.sourceList.find((source) => source.path === sourcePath)

      if (selectedSourceItem) {
        const [rangeStart, rangeEnd] = range

        result.push({
          id: `${selectedSourceItem.name}-${selectedSourceItem.path}`,
          name: selectedSourceItem.name,
          items: documentationRepository.documentationList.slice(rangeStart, rangeEnd + 1)
        })
      }
    }

    return result
  }, [documentationRepository, sourceToDocumentationRangeMap])

  const dropdownSourceFilesEl = (
    <List.Dropdown
      tooltip="Select a documentation source to search"
      value={`${selectedSource.name}\n${selectedSource.path}`}
      onChange={(newValue) => {
        const [name, path] = newValue.split('\n')

        setSelectedSource({
          name,
          path
        })
      }}
    >
      {sourceDropdownItems.map((item) => (
        <List.Dropdown.Item
          key={`${item.name}-${item.path}`}
          title={item.name}
          value={`${item.name}\n${item.path}`}
          icon={getSourceIcon(item)}
        />
      ))}
    </List.Dropdown>
  )

  let listContentEl

  if (selectedSource.path === '*') {
    const groupEls = []

    for (const group of groups) {
      groupEls.push(
        <List.Section key={group.id} title={group.name}>
          {renderListItems(group.items, documentationItemsMap)}
        </List.Section>
      )
    }

    listContentEl = groupEls
  } else {
    const selectedSourceItem = documentationRepository.sourceList.find((source) => source.path === selectedSource.path)
    const targetPath = selectedSourceItem?.path ?? ''

    const range = sourceToDocumentationRangeMap.get(targetPath)

    if (range) {
      const [rangeStart, rangeEnd] = range
      listContentEl = renderListItems(
        documentationRepository.documentationList.slice(rangeStart, rangeEnd + 1),
        documentationItemsMap
      )
    }
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Type to search Hammerspoon documentation..."
      searchBarAccessory={dropdownSourceFilesEl}
    >
      {listContentEl}
    </List>
  )
}

type SourceType = 'hs' | 'Lua' | 'Spoon'

interface SourceItem {
  type?: SourceType
  name: string
  path: string
}

interface DocumentationOutput {
  builtInFiles: string[]
  allFiles: string[]
}

interface DocumentationRepository {
  sourceList: SourceItem[]
  sourceToDocumentationRangeEntries: Array<[string, [number, number]]>
  documentationList: DocumentationItem[]
  documentationItemsEntries: Array<[string, number]>
}

interface DocumentationItem {
  id: string
  sourceType: SourceType
  sourceFile: string
  name: string
  type: string
  description: string
  documentation: string
  parentId?: string
}

function renderListItems(items: DocumentationItem[], documentationItemsMap: Map<string, number>) {
  return items.map((item) => {
    const keywords = item.name.includes('.') ? item.name.split('.') : []

    return (
      <List.Item
        key={item.id}
        icon={{ value: getDocumentationTypeIcon(item), tooltip: item.type }}
        title={{ value: item.name, tooltip: item.type }}
        keywords={keywords}
        subtitle={{ value: item.description, tooltip: item.description }}
        actions={
          <ActionPanel>
            <Action.Push title="Show Details" target={<Detail markdown={getMarkdownForDocumentationItem(item)} />} />
          </ActionPanel>
        }
      />
    )
  })
}

function getSourceIcon(sourceItem: SourceItem) {
  if (sourceItem.type == null) {
    return '🌐'
  }

  if (sourceItem.type === 'hs') {
    return { source: 'icon-prod.png' }
  } else if (sourceItem.type === 'Lua') {
    return { source: 'icon-lua.png', tintColor: Color.SecondaryText }
  } else {
    return '🥄'
  }
}

function getDocumentationTypeIcon(documentationItem: DocumentationItem) {
  // the icons were taken from vscode icons and carbon design system icons
  // https://github.com/microsoft/vscode-icons/tree/main/icons/dark
  // https://github.com/carbon-design-system/carbon/blob/main/packages/icons/src/svg/32
  // we just converted them to 64x64 png with
  // https://cloudconvert.com/svg-to-png
  if (documentationItem.type === 'Module') {
    return { source: 'symbol-namespace.png', tintColor: Color.SecondaryText }
  } else if (documentationItem.type === 'Variable') {
    return { source: 'symbol-variable.png', tintColor: Color.Blue }
  } else if (documentationItem.type === 'Field') {
    return { source: 'symbol-field.png', tintColor: Color.Blue }
  } else if (documentationItem.type === 'Constant') {
    return { source: 'symbol-constant.png', tintColor: Color.Blue }
  } else if (documentationItem.type === 'Constructor') {
    return { source: 'symbol-interface.png', tintColor: Color.Orange }
  } else if (documentationItem.type === 'Method') {
    return { source: 'function.png', tintColor: Color.Magenta }
  } else if (documentationItem.type === 'Function') {
    return { source: 'function-math.png', tintColor: Color.Magenta }
  } else if (documentationItem.type === 'Deprecated') {
    return { source: 'warning.png', tintColor: Color.Yellow }
  } else if (documentationItem.type === 'builtin') {
    return { source: 'symbol-misc.png', tintColor: Color.Magenta }
  } else if (documentationItem.type === 'c-api') {
    return { source: 'fragments.png', tintColor: Color.Orange }
  } else if (documentationItem.type === 'manual') {
    return { source: 'book.png', tintColor: Color.SecondaryText }
  }

  return { source: 'symbol-keyword.png', tintColor: Color.SecondaryText }
}

function getMarkdownForDocumentationItem(item: DocumentationItem): string {
  return `# ${item.name}\n\n${item.documentation}`
}

async function extractDocumentationFromDocsFiles(docsInfo: DocumentationOutput) {
  const builtInFiles = docsInfo?.builtInFiles ?? []
  const allFiles = docsInfo?.allFiles ?? []
  const documentationList: DocumentationItem[] = []
  const sourceList: SourceItem[] = []
  const sourceToDocumentationRangeEntries: Pick<
    DocumentationRepository,
    'sourceToDocumentationRangeEntries'
  >['sourceToDocumentationRangeEntries'] = []
  const documentationItemsEntries: Pick<
    DocumentationRepository,
    'documentationItemsEntries'
  >['documentationItemsEntries'] = []

  let itemIdx = -1

  for (const docFilePath of allFiles) {
    let sourceName = path.basename(path.dirname(docFilePath))
    let sourceType: Pick<DocumentationItem, 'sourceType'>['sourceType'] = 'Spoon'

    if (docFilePath === builtInFiles[0]) {
      sourceName = 'hs'
      sourceType = 'hs'
    } else if (docFilePath === builtInFiles[1]) {
      sourceName = 'Lua'
      sourceType = 'Lua'
    }

    sourceList.push({
      type: sourceType,
      name: sourceName,
      path: docFilePath
    })

    let items

    try {
      const fileContent = await fsPromise.readFile(docFilePath)
      items = JSON.parse(fileContent.toString())
    } catch (error) {
      throw new Error(`Error when parsing json of documentation file at "${docFilePath}"`, { cause: error })
    }

    const toProcess = items.map((item: object) => ({ item }))

    let rangeStart = -1

    while (toProcess.length > 0) {
      const current = toProcess.shift()

      if (current == null) {
        continue
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { parent, item } = current as { parent?: DocumentationItem; item: any }

      try {
        assert(item.name != null, `Expected to get a non-null name`)
        assert(typeof item.name === 'string', `Expected name to be a string`)
        assert(item.name.trim().length > 0, `Expected name to be non-empty string`)

        let type = item.type
        let name

        if (parent == null && sourceType === 'Lua') {
          if (!type) {
            type = 'manual'
          }

          name = item.name.startsWith('lua.') ? item.name.slice(4) : item.name
        } else {
          name = item.name
        }

        if (parent != null) {
          // skip adding Lua prefix for globals
          const parentName = sourceType === 'Lua' && parent.name === 'lua' ? '' : parent.name

          if (parentName !== '') {
            name = `${parent.name}.${name}`
          }
        }

        if (parent != null) {
          assert(item.type != null, `Expected to get a non-null type`)
          assert(typeof item.type === 'string', `Expected type to be a string`)
          assert(item.type.trim().length > 0, `Expected type to be non-empty string`)
        }

        const idParts = []

        if (parent != null) {
          idParts.push(parent.id)
        } else {
          idParts.push(sourceType)
        }

        idParts.push(type)
        idParts.push(name)

        let description = item.desc

        // generate description from .doc when it does not exists
        if (description == null) {
          const firstNewLineIndex = item.doc.indexOf('\n')

          if (firstNewLineIndex === -1) {
            description = item.doc.slice(0, 100)
          } else {
            description = item.doc.slice(0, firstNewLineIndex)
          }

          if (description.startsWith('`') && description.endsWith('`')) {
            description = description.slice(1, -1)
          }
        }

        let documentation = item.doc

        // verify that .desc is part of .doc, if not concat it to
        // get the final documentation to use
        if (item.desc != null && !item.doc.startsWith(item.desc)) {
          documentation = item.desc + '\n\n' + item.doc
        }

        const docItem: DocumentationItem = {
          id: idParts.join('-'),
          sourceType,
          sourceFile: docFilePath,
          name,
          type: type,
          description,
          documentation,
          parentId: parent?.id
        }

        // keep a record of the id to index of the item in the documentation list
        // for fast access
        documentationItemsEntries.push([docItem.id, documentationList.length])
        documentationList.push(docItem)
        itemIdx++

        if (rangeStart === -1) {
          rangeStart = itemIdx
        }

        if (Array.isArray(item.items)) {
          if (parent != null) {
            throw new Error(`Expected that subitem does not contain more items`)
          }

          // process subitems as the last elements after root items
          toProcess.push(
            ...item.items.map((subitem: object) => ({
              item: subitem,
              parent: docItem
            }))
          )
        }
      } catch (error) {
        let msg = `Error when processing documentation file at "${docFilePath}"`

        if (parent && typeof parent.name === 'string') {
          msg += ` (parent: "${parent.name}")`
        }

        if (typeof item.name === 'string') {
          msg += ` (item: "${item.name}")`
        }

        msg += '.'

        if (error instanceof Error) {
          msg += `Details: ${error.message}`
        }

        throw new Error(msg, { cause: error })
      }
    }

    if (rangeStart !== -1) {
      sourceToDocumentationRangeEntries.push([docFilePath, [rangeStart, itemIdx]])
    }
  }

  return {
    sourceList,
    sourceToDocumentationRangeEntries,
    documentationList,
    documentationItemsEntries
  }
}
