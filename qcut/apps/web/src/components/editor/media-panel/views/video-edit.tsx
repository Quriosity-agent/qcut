"use client";

import { useState } from "react";
import { Wand2Icon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { VideoEditTab } from "./video-edit-types";

export default function VideoEditView() {
  const [activeTab, setActiveTab] = useState<VideoEditTab>("audio-gen");

  return (
    <div className="h-full flex flex-col p-4">
      {/* Header */}
      <div className="flex items-center mb-4">
        <Wand2Icon className="size-5 text-primary mr-2" />
        <h3 className="text-sm font-medium">Video Edit</h3>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as VideoEditTab)}
        className="flex-1 flex flex-col"
      >
        <TabsList className="grid w-full grid-cols-3 mb-4">
          <TabsTrigger value="audio-gen">Audio Gen</TabsTrigger>
          <TabsTrigger value="audio-sync">Audio Sync</TabsTrigger>
          <TabsTrigger value="upscale">Upscale</TabsTrigger>
        </TabsList>

        {/* Kling Video to Audio Tab */}
        <TabsContent value="audio-gen" className="flex-1 space-y-4">
          <div className="text-sm text-muted-foreground">
            Kling Video to Audio - Implementation pending
          </div>
        </TabsContent>

        {/* MMAudio V2 Tab */}
        <TabsContent value="audio-sync" className="flex-1 space-y-4">
          <div className="text-sm text-muted-foreground">
            MMAudio V2 - Implementation pending
          </div>
        </TabsContent>

        {/* Topaz Upscale Tab */}
        <TabsContent value="upscale" className="flex-1 space-y-4">
          <div className="text-sm text-muted-foreground">
            Topaz Upscale - Implementation pending
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
