/*
 * 模型在跑时的小图标：三层各三个节点连成一张网，节点依次明暗，三颗粒子沿中线来回，
 * 中心一块缩放，外圈一道虚线慢转。样式在 neural-loading.css，颜色取次要字色，
 * 放在状态格里和对勾、叉号同一个尺寸。对读屏隐藏：旁边总有一句正在做什么。
 */

const LAYERS = [0, 1, 2] as const;

export function NeuralLoading({
	size = 16,
}: {
	/** 边长，px。 */
	size?: number;
}) {
	return (
		<span
			aria-hidden="true"
			className="ui-neural-loading"
			style={{ height: size, width: size }}
		>
			<svg aria-hidden="true" viewBox="0 0 100 100">
				{LAYERS.slice(0, -1).flatMap((layer) =>
					LAYERS.flatMap((from) =>
						LAYERS.map((to) => (
							<line
								className="ui-neural-loading-link"
								key={`${layer}-${from}-${to}`}
								x1={25 + layer * 25}
								x2={50 + layer * 25}
								y1={25 + from * 25}
								y2={25 + to * 25}
							/>
						)),
					),
				)}
				{LAYERS.flatMap((layer) =>
					LAYERS.map((node) => (
						<circle
							className="ui-neural-loading-node"
							cx={25 + layer * 25}
							cy={25 + node * 25}
							key={`${layer}-${node}`}
							r="3"
							style={{ animationDelay: `${(layer * 3 + node) * 0.2}s` }}
						/>
					)),
				)}
				{LAYERS.map((index) => (
					<circle
						className="ui-neural-loading-particle"
						cx={25}
						cy={50}
						key={index}
						r="1.5"
						style={{ animationDelay: `${index * 0.6}s` }}
					/>
				))}
				<rect
					className="ui-neural-loading-center"
					height="6"
					width="6"
					x="47"
					y="47"
				/>
				<circle className="ui-neural-loading-ring" cx="50" cy="50" r="40" />
			</svg>
		</span>
	);
}
