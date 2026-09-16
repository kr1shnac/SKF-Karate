import { VideosPageSkeleton } from '../_components/skeletons/VideosPageSkeleton';
import { SkeletonLoadingWrapper } from '@/components/navigation/SkeletonLoadingWrapper'
import './videos.css';

export default function Loading() {
  return <SkeletonLoadingWrapper><VideosPageSkeleton /></SkeletonLoadingWrapper>;
}
