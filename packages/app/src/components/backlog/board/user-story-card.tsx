import {
  type UserStory,
} from "@/components/backlog/data/backlog-data"
import { storyDetail, storyStatus } from "@/components/backlog/shared/backlog-helpers"
import { StoryStatusBadge } from "@/components/backlog/shared/backlog-status-badge"
import type { OpenDrawer } from "@/components/backlog/shared/backlog-types"
import { StoryActions } from "@/components/backlog/actions/story-actions"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function UserStoryCard({
  onOpenDrawer,
  story,
}: {
  onOpenDrawer: OpenDrawer
  story: UserStory
}) {
  return (
    <Card size="sm" className="group/user-story rounded-lg">
      <CardHeader className="gap-0 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <p className="text-xs font-medium text-muted-foreground">
          {userStoryLabel(story)}
        </p>
        <CardTitle className="min-w-0 text-base leading-snug">
          <Button
            type="button"
            variant="link"
            className="h-auto min-w-0 max-w-full shrink justify-start whitespace-normal break-words p-0 text-left text-base leading-snug font-medium text-card-foreground transition-colors group-hover/user-story:text-blue-600 hover:cursor-pointer dark:group-hover/user-story:text-blue-300"
            onClick={() =>
              onOpenDrawer({
                userStory: story,
                mode:
                  story.status === "backlog" || story.status === "discarded"
                    ? "edit"
                    : "view",
                initialTab: "user-story",
              })
            }
          >
            {story.title}
          </Button>
        </CardTitle>
        {storyStatus(story) && (
          <CardAction>
            <StoryStatusBadge status={storyStatus(story)} />
          </CardAction>
        )}
      </CardHeader>
      {storyDetail(story) && (
        <CardContent>
          <p className="text-xs font-medium text-muted-foreground">
            {storyDetail(story)}
          </p>
        </CardContent>
      )}
      <CardFooter>
        <StoryActions onOpenDrawer={onOpenDrawer} story={story} />
      </CardFooter>
    </Card>
  )
}

function userStoryLabel(story: UserStory) {
  return `US-${String(story.id).padStart(3, "0")}`
}
