import React from 'react';
import type { UUID, Memory } from '@elizaos/core';
import { Book, Clock, File, FileText, LoaderIcon, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Use local UI components instead of importing from client
import { Badge } from './badge';
import { Button } from './button';
import { Card, CardFooter, CardHeader } from './card';
import { Input } from './input';
import { MemoryGraph } from './memory-graph';

// Local utility function instead of importing from client
const cn = (...classes: (string | undefined | null | false)[]) => {
    return classes.filter(Boolean).join(' ');
};

// Temporary toast implementation
const useToast = () => ({
    toast: ({ title, description, variant }: { title: string; description: string; variant?: string }) => {
        console.log(`Toast: ${title} - ${description} (${variant || 'default'})`);
        // TODO: Implement proper toast functionality
    }
});

// Simple Dialog components for now
const Dialog = ({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => onOpenChange(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-full max-h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
                {children}
            </div>
        </div>
    );
};

const DialogContent = ({ className, children }: { className?: string; children: React.ReactNode }) => (
    <div className={cn("p-6 flex flex-col", className)}>{children}</div>
);

const DialogHeader = ({ className, children }: { className?: string; children: React.ReactNode }) => (
    <div className={cn("mb-4", className)}>{children}</div>
);

const DialogTitle = ({ className, children }: { className?: string; children: React.ReactNode }) => (
    <h2 className={cn("text-lg font-semibold", className)}>{children}</h2>
);

const DialogDescription = ({ className, children }: { className?: string; children: React.ReactNode }) => (
    <p className={cn("text-sm text-gray-600", className)}>{children}</p>
);

const DialogFooter = ({ className, children }: { className?: string; children: React.ReactNode }) => (
    <div className={cn("flex justify-end gap-2 mt-4", className)}>{children}</div>
);

const ITEMS_PER_PAGE = 10;

interface MemoryContent {
    text?: string;
    metadata?: {
        fileType?: string;
        title?: string;
        filename?: string;
        path?: string;
        description?: string;
    };
}

interface MemoryMetadata {
    type?: string;
    title?: string;
    filename?: string;
    path?: string;
    description?: string;
    fileExt?: string;
    timestamp?: number;
    contentType?: string;
    documentId?: string;
}

interface UploadResultItem {
    status: string;
    id?: UUID;
    filename?: string;
}

// Updated placeholder apiClient to use fetch for actual plugin endpoints
const apiClient = {
    getKnowledgeDocuments: async (agentId: UUID, options?: { limit?: number; before?: number; includeEmbedding?: boolean }) => {
        const params = new URLSearchParams();
        if (options?.limit) params.append('limit', options.limit.toString());
        if (options?.before) params.append('before', options.before.toString());
        if (options?.includeEmbedding) params.append('includeEmbedding', 'true');

        const response = await fetch(`/api/agents/${agentId}/plugins/knowledge/documents?${params.toString()}`);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch knowledge documents: ${response.status} ${errorText}`);
        }
        const result = await response.json();
        return result; // Assuming API returns { success: true, data: { memories: [] } } or similar
    },
    deleteKnowledgeDocument: async (agentId: UUID, knowledgeId: UUID) => {
        const response = await fetch(`/api/agents/${agentId}/plugins/knowledge/knowledges/${knowledgeId}`, {
            method: 'DELETE',
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to delete knowledge document: ${response.status} ${errorText}`);
        }
        // DELETE often returns 204 No Content, or a success message
        if (response.status === 204) return;
        return await response.json();
    },
    uploadKnowledge: async (agentId: string, files: File[]) => {
        const formData = new FormData();
        files.forEach(file => formData.append('files', file));

        const response = await fetch(`/api/agents/${agentId}/plugins/knowledge/knowledges`, {
            method: 'POST',
            body: formData,
            // Note: Content-Type is set automatically by browser for FormData
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to upload knowledge: ${response.status} ${errorText}`);
        }
        return await response.json(); // Assuming API returns an object { success: true, data: [...] }
    },
    addKnowledgeFromUrl: async (agentId: string, urls: string[]) => {
        const response = await fetch(`/api/agents/${agentId}/plugins/knowledge/knowledges`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fileUrls: urls })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to add knowledge from URL: ${response.status} ${errorText}`);
        }
        return await response.json();
    }
};

// TODO: Update this hook to use a new apiClient method targeting GET /api/agents/${agentId}/plugins/knowledge/documents
// The apiClient itself will need to be updated/extended to support these new plugin-specific routes.
const useKnowledgeDocuments = (agentId: UUID, enabled: boolean = true, includeEmbedding: boolean = false) => {
    return useQuery<Memory[], Error>({
        queryKey: ['agents', agentId, 'knowledge', 'documents', { includeEmbedding }],
        queryFn: async () => {
            // This apiClient call WILL FAIL until apiClient is updated to target the plugin.
            // It currently points to the old /api/agents/:agentId/memories?tableName=documents endpoint.
            const response = await apiClient.getKnowledgeDocuments(agentId, { includeEmbedding });
            return response.data.memories;
        },
        enabled,
    });
};

// TODO: Update this hook to use a new apiClient method targeting DELETE /api/agents/${agentId}/plugins/knowledge/documents/${knowledgeId}
// The apiClient itself will need to be updated/extended.
const useDeleteKnowledgeDocument = (agentId: UUID) => {
    const queryClient = useQueryClient();
    return useMutation<
        void,
        Error,
        { knowledgeId: UUID }
    >({
        mutationFn: async ({ knowledgeId }) => {
            // This apiClient call WILL FAIL until apiClient is updated.
            // It currently points to the old /api/agents/:agentId/memories/:memoryId endpoint.
            // The type for arguments might also be different for the new plugin endpoint.
            await apiClient.deleteKnowledgeDocument(agentId, knowledgeId);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ['agents', agentId, 'knowledge', 'documents'],
            });
        },
    });
};

export function KnowledgeTab({ agentId }: { agentId: UUID }) {
    const [viewingContent, setViewingContent] = useState<Memory | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [visibleItems, setVisibleItems] = useState(ITEMS_PER_PAGE);
    const [loadingMore, setLoadingMore] = useState(false);
    const [viewMode, setViewMode] = useState<'list' | 'graph'>('list');
    const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
    const [pdfZoom, setPdfZoom] = useState(1.0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const {
        data: memories = [],
        isLoading,
        error,
    } = useKnowledgeDocuments(agentId, true, viewMode === 'graph');

    const { mutate: deleteKnowledgeDoc } = useDeleteKnowledgeDocument(agentId);

    const handleScroll = useCallback(() => {
        if (!scrollContainerRef.current || loadingMore || visibleItems >= memories.length) {
            return;
        }
        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
        const scrolledToBottom = scrollTop + clientHeight >= scrollHeight - 100;
        if (scrolledToBottom) {
            setLoadingMore(true);
            setTimeout(() => {
                setVisibleItems((prev) => Math.min(prev + ITEMS_PER_PAGE, memories.length));
                setLoadingMore(false);
            }, 300);
        }
    }, [loadingMore, visibleItems, memories.length]);

    useEffect(() => {
        setVisibleItems(ITEMS_PER_PAGE);
    }, []);

    useEffect(() => {
        const scrollContainer = scrollContainerRef.current;
        if (scrollContainer) {
            scrollContainer.addEventListener('scroll', handleScroll);
            return () => scrollContainer.removeEventListener('scroll', handleScroll);
        }
    }, [handleScroll]);

    if (isLoading && (!memories || memories.length === 0)) {
        return (
            <div className="flex items-center justify-center h-40">Loading knowledge documents...</div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-40 text-destructive">
                Error loading knowledge documents: {error.message}
            </div>
        );
    }

    const formatDate = (timestamp: number) => {
        const date = new Date(timestamp);
        return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    };

    const getFileIcon = (fileName: string) => {
        const ext = fileName.split('.').pop()?.toLowerCase();
        switch (ext) {
            case 'md': return <File className="h-4 w-4 text-blue-500" />;
            case 'js': case 'ts': case 'jsx': case 'tsx': return <File className="h-4 w-4 text-yellow-500" />;
            case 'json': return <File className="h-4 w-4 text-green-500" />;
            case 'pdf': return <FileText className="h-4 w-4 text-red-500" />;
            default: return <FileText className="h-4 w-4 text-gray-500" />;
        }
    };

    const handleDelete = (knowledgeId: string) => {
        if (knowledgeId && window.confirm('Are you sure you want to delete this document?')) {
            deleteKnowledgeDoc(
                { knowledgeId: knowledgeId as UUID },
                {
                    onError: (error) => {
                        toast({
                            title: 'Deletion Failed',
                            description: error instanceof Error ? error.message : 'Failed to delete knowledge document',
                            variant: 'destructive',
                        });
                    },
                    onSuccess: () => {
                        toast({
                            title: 'Document Deleted',
                            description: 'Knowledge document successfully deleted',
                        });
                        setViewingContent(null);
                    }
                }
            );
        }
    };

    const handleUploadClick = () => {
        if (fileInputRef.current) fileInputRef.current.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        setIsUploading(true);
        try {
            const fileArray = Array.from(files);
            const result = await apiClient.uploadKnowledge(agentId, fileArray);

            // The actual array of upload outcomes is in result.data
            const uploadOutcomes: UploadResultItem[] = result.data || [];

            if (Array.isArray(uploadOutcomes) && uploadOutcomes.every((r: UploadResultItem) => r.status === 'success')) {
                toast({
                    title: 'Knowledge Uploaded',
                    description: `Successfully uploaded ${fileArray.length} file(s)`,
                });
                queryClient.invalidateQueries({
                    queryKey: ['agents', agentId, 'knowledge', 'documents'],
                });
            } else {
                const successfulUploads = uploadOutcomes.filter((r: UploadResultItem) => r.status === 'success').length;
                const failedUploads = fileArray.length - successfulUploads;
                toast({
                    title: failedUploads > 0 ? 'Upload Partially Failed' : 'Upload Issues',
                    description: `Uploaded ${successfulUploads} file(s). ${failedUploads} file(s) failed. Check console for details.`,
                    variant: failedUploads > 0 ? 'destructive' : 'default',
                });
                console.error('Upload results:', uploadOutcomes);
            }
        } catch (uploadError: any) {
            toast({
                title: 'Upload Failed',
                description: uploadError instanceof Error ? uploadError.message : 'Failed to upload knowledge files',
                variant: 'destructive',
            });
            console.error('Upload error:', uploadError);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const visibleMemories = memories.slice(0, visibleItems);
    const hasMoreToLoad = visibleItems < memories.length;

    const LoadingIndicator = () => (
        <div className="flex justify-center p-4">
            {loadingMore ? (
                <div className="flex items-center gap-2">
                    <LoaderIcon className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">Loading more...</span>
                </div>
            ) : (
                <Button variant="ghost" size="sm" onClick={() => setVisibleItems((prev) => prev + ITEMS_PER_PAGE)} className="text-xs">
                    Show more
                </Button>
            )}
        </div>
    );

    const EmptyState = () => (
        <div className="text-muted-foreground text-center p-12 flex flex-col items-center gap-3 border-2 border-dashed rounded-lg mt-8">
            <Book className="h-12 w-12 text-muted-foreground opacity-20" />
            <h3 className="text-lg font-medium">No Knowledge Documents</h3>
            <p className="max-w-md text-sm">No Knowledge Documents found.</p>
            <Button variant="outline" onClick={handleUploadClick}>
                <Upload className="h-4 w-4 mr-2" />
                Upload Documents
            </Button>
        </div>
    );

    const KnowledgeCard = ({ memory, index }: { memory: Memory; index: number }) => {
        const metadata = (memory.metadata as MemoryMetadata) || {};
        const title = metadata.title || memory.id || 'Unknown Document';
        const filename = metadata.filename || 'Unknown Document';
        const fileExt = metadata.fileExt || filename.split('.').pop()?.toLowerCase() || '';
        const displayName = title || filename;
        const subtitle = metadata.path || filename;

        return (
            <button key={memory.id || index} type="button" className="w-full text-left" onClick={() => setViewingContent(memory)}>
                <Card className="hover:bg-accent/10 transition-colors relative group">
                    <div className="absolute top-3 left-3 opacity-70">{getFileIcon(filename)}</div>
                    <CardHeader className="p-3 pb-2 pl-10">
                        <div className="text-xs text-muted-foreground mb-1 line-clamp-1">{subtitle}</div>
                        <div className="mb-2">
                            <div className="text-sm font-medium mb-1">{displayName}</div>
                            {metadata.description && (
                                <div className="text-xs text-muted-foreground line-clamp-2">{metadata.description}</div>
                            )}
                        </div>
                    </CardHeader>
                    <CardFooter className="p-2 border-t bg-muted/30 text-xs text-muted-foreground">
                        <div className="flex justify-between items-center w-full">
                            <div className="flex items-center">
                                <Clock className="h-3 w-3 mr-1.5" />
                                <span>
                                    {new Date(memory.createdAt || 0).toLocaleString(undefined, {
                                        month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric',
                                    })}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Badge variant="outline" className="px-1.5 py-0 h-5">{fileExt || 'unknown document'}</Badge>
                                {memory.id && (
                                    <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => {
                                        if (e) {
                                            e.stopPropagation();
                                            e.preventDefault();
                                        }
                                        handleDelete(memory.id || '');
                                    }} title="Delete knowledge">
                                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    </CardFooter>
                </Card>
            </button>
        );
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between p-4 border-b">
                <h2 className="text-lg font-semibold">Knowledge</h2>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setViewMode(viewMode === 'list' ? 'graph' : 'list')}>
                        {viewMode === 'list' ? 'Graph' : 'List'}
                    </Button>
                    <Button onClick={handleUploadClick} disabled={isUploading}>
                        {isUploading ? <LoaderIcon className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                        Upload
                    </Button>
                </div>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".txt,.md,.markdown,.pdf,.doc,.docx,.json,.xml,.yaml,.yml,.csv,.tsv,.log,.ini,.cfg,.conf,.env,.gitignore,.dockerignore,.editorconfig,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.pyw,.pyi,.java,.c,.cpp,.cc,.cxx,.h,.hpp,.cs,.php,.rb,.go,.rs,.swift,.kt,.kts,.scala,.clj,.cljs,.ex,.exs,.r,.R,.m,.mm,.sh,.bash,.zsh,.fish,.ps1,.bat,.cmd,.sql,.html,.htm,.css,.scss,.sass,.less,.vue,.svelte,.astro,.lua,.pl,.pm,.dart,.hs,.elm,.ml,.fs,.fsx,.vb,.pas,.d,.nim,.zig,.jl,.tcl,.awk,.sed"
                onChange={handleFileChange}
                className="hidden"
            />

            <div className="flex-1 overflow-hidden">
                {memories.length === 0 ? (
                    <EmptyState />
                ) : viewMode === 'graph' ? (
                    <div className="h-full p-4">
                        <MemoryGraph
                            memories={memories}
                            onNodeClick={setSelectedMemory}
                            selectedMemoryId={selectedMemory?.id}
                        />
                    </div>
                ) : (
                    <div ref={scrollContainerRef} className="h-full overflow-y-auto p-4">
                        <div className="grid gap-3">
                            {visibleMemories.map((memory, index) => (
                                <KnowledgeCard key={memory.id || index} memory={memory} index={index} />
                            ))}
                        </div>
                        {hasMoreToLoad && <LoadingIndicator />}
                    </div>
                )}
            </div>

            {viewingContent && (
                <Dialog open={!!viewingContent} onOpenChange={() => setViewingContent(null)}>
                    <DialogContent className="max-w-[95vw] w-full max-h-[95vh] h-full overflow-hidden flex flex-col p-0">
                        <DialogHeader className="flex-shrink-0 p-6 pb-2">
                            <div className="flex items-center justify-between">
                                <div>
                                    <DialogTitle className="text-xl">
                                        {(viewingContent.metadata as MemoryMetadata)?.title || 'Document Content'}
                                    </DialogTitle>
                                    <DialogDescription>
                                        {(viewingContent.metadata as MemoryMetadata)?.filename || 'Knowledge document'}
                                    </DialogDescription>
                                </div>
                                {(() => {
                                    const metadata = viewingContent.metadata as MemoryMetadata;
                                    const contentType = metadata?.contentType || '';
                                    const fileExt = metadata?.fileExt?.toLowerCase() || '';
                                    const isPdf = contentType === 'application/pdf' || fileExt === 'pdf';

                                    if (isPdf) {
                                        return (
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setPdfZoom(Math.max(0.5, pdfZoom - 0.25))}
                                                    disabled={pdfZoom <= 0.5}
                                                >
                                                    <span className="text-lg">−</span>
                                                </Button>
                                                <span className="text-sm font-medium min-w-[60px] text-center">
                                                    {Math.round(pdfZoom * 100)}%
                                                </span>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setPdfZoom(Math.min(3, pdfZoom + 0.25))}
                                                    disabled={pdfZoom >= 3}
                                                >
                                                    <span className="text-lg">+</span>
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setPdfZoom(1.0)}
                                                >
                                                    Reset
                                                </Button>
                                            </div>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>
                        </DialogHeader>
                        <div className="flex-1 overflow-auto px-6 pb-2">
                            {(() => {
                                const metadata = viewingContent.metadata as MemoryMetadata;
                                const contentType = metadata?.contentType || '';
                                const fileExt = metadata?.fileExt?.toLowerCase() || '';
                                const isPdf = contentType === 'application/pdf' || fileExt === 'pdf';

                                if (isPdf && viewingContent.content?.text) {
                                    // For PDFs, the content.text contains base64 data
                                    // Create a data URL for the PDF
                                    const pdfDataUrl = `data:application/pdf;base64,${viewingContent.content.text}`;

                                    return (
                                        <div className="w-full h-full rounded-lg overflow-auto bg-gray-100 dark:bg-gray-900">
                                            <div
                                                className="min-w-full flex items-center justify-center p-4"
                                                style={{
                                                    minHeight: '100%',
                                                    transform: `scale(${pdfZoom})`,
                                                    transformOrigin: 'top center',
                                                    width: pdfZoom > 1 ? `${100 / pdfZoom}%` : '100%'
                                                }}
                                            >
                                                <iframe
                                                    src={pdfDataUrl}
                                                    className="w-full border-0 shadow-lg"
                                                    style={{
                                                        height: '90vh',
                                                        maxWidth: '1200px',
                                                    }}
                                                    title="PDF Document"
                                                />
                                            </div>
                                        </div>
                                    );
                                } else {
                                    // For all other documents, display as plain text
                                    return (
                                        <div className="h-full w-full bg-gray-50 dark:bg-gray-900 rounded-lg border p-6">
                                            <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed text-gray-800 dark:text-gray-200 min-w-0 break-words">
                                                {viewingContent.content?.text || 'No content available'}
                                            </pre>
                                        </div>
                                    );
                                }
                            })()}
                        </div>
                        <DialogFooter className="flex-shrink-0 p-6 pt-4">
                            <Button variant="outline" onClick={() => {
                                setViewingContent(null);
                                setPdfZoom(1.0); // Reset zoom when closing
                            }}>
                                Close
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
}
