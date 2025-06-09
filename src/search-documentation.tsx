import assert from 'node:assert/strict'
import fsPromise from 'node:fs/promises'
import { ActionPanel, Detail, List, Action, Icon } from '@raycast/api'
import { runAppleScript, useCachedPromise, useCachedState } from '@raycast/utils'
import { useMemo } from 'react'
import path from 'node:path'

const defaultSource = { name: 'All Sources', path: '*' }

export default function main() {
  const [selectedSource, setSelectedSource] = useCachedState<SourceItem>('selected-sourced', defaultSource)

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
      initialData: { sourceList: [], documentationList: [] },
      failureToastOptions: {
        title: "Couldn't resolve documentation files of Hammerspoon"
      }
    }
  )

  const sourceDropdownItems = useMemo(() => {
    const files: SourceItem[] = [defaultSource]
    files.push(...documentationRepository.sourceList)
    return files
  }, [documentationRepository])

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
          icon={Icon.Folder}
        />
      ))}
    </List.Dropdown>
  )

  const listItems = useMemo(() => {
    if (selectedSource.path === '*') {
      return documentationRepository.documentationList
    }

    return documentationRepository.documentationList.filter((item) => item.sourceFile === selectedSource.path)
  }, [documentationRepository, selectedSource])

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Type to search Hammerspoon documentation..."
      searchBarAccessory={dropdownSourceFilesEl}
    >
      <List.Section title="Results">
        {listItems.map((item) => (
          <List.Item
            key={item.id}
            icon={Icon.Bird}
            title={item.name}
            subtitle={item.description}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Show Details"
                  target={<Detail markdown={getMarkdownForDocumentationItem(item)} />}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  )
}

interface SourceItem {
  name: string
  path: string
}

interface DocumentationOutput {
  builtInFiles: string[]
  allFiles: string[]
}

interface DocumentationRepository {
  sourceList: SourceItem[]
  documentationList: DocumentationItem[]
  documentationItemsMap: Map<string, number>
}

interface DocumentationItem {
  id: string
  sourceType: 'hs' | 'Lua' | 'Spoon'
  sourceFile: string
  name: string
  type: string
  description: string
  documentation: string
  parentId?: string
}

function getMarkdownForDocumentationItem(item: DocumentationItem): string {
  return `# ${item.name}\n\n${item.description}\n\n${item.documentation}`
}

async function extractDocumentationFromDocsFiles(docsInfo: DocumentationOutput) {
  const builtInFiles = docsInfo?.builtInFiles ?? []
  const allFiles = docsInfo?.allFiles ?? []
  const documentationList: DocumentationItem[] = []
  const sourceList: SourceItem[] = []
  const documentationItemsMap = new Map<string, number>()

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

        if (parent == null && sourceType === 'Lua' && !type) {
          type = 'Module'
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

        idParts.push(item.type)
        idParts.push(item.name)

        const docItem: DocumentationItem = {
          id: idParts.join('-'),
          sourceType,
          sourceFile: docFilePath,
          name: item.name,
          type: item.type,
          // TODO: we are setting a default value here for these keys
          // just for debugging purposes, we should analyze the json values
          // and decide what to do if the values are missing.
          // Also seems that .desc is always present in .doc, .desc seems to be a short representation of .doc
          // (or fist characters of what the .doc contains), in any case we should check if this is always the case.
          // if not we concat the .desc + .doc = our documentation.
          // the intention will be that we use .description for the List item subtitle
          // and .documentation as the body of the text we show in Detail
          description: item.desc || '_No Description_',
          documentation: item.doc || '_No Documentation_',
          parentId: parent?.id
        }

        // keep a record of the id to index of the item in the documentation list
        // for fast access
        documentationItemsMap.set(docItem.id, documentationList.length)
        documentationList.push(docItem)

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
  }

  return { sourceList, documentationList, documentationItemsMap }
}
