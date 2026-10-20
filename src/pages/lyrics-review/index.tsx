import ReviewTab from "@/components/lyrics-align-modal/review-tab";
import ScrollContainer from "@/components/scroll-container";

const LyricsReview = () => (
  <ScrollContainer pageScroll enableBackToTop className="h-full w-full px-4">
    <div className="mb-2">
      <h1>歌词审核</h1>
      <p className="text-foreground-500 mt-1 text-sm">
        自动对齐的结果不经审核直接生效，这里只有两类事：用户上传的歌词（试听后通过或打回），和对时间轴的报错（确认有误就下线）。先来的排在前面
      </p>
    </div>
    <ReviewTab />
  </ScrollContainer>
);

export default LyricsReview;
