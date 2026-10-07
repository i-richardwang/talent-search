import { type ReactNode, useId, useState } from "react";
import { Tag } from "./tag";

/*
 * 挂在一条回复里的一问几选：一句问话，下面一列带编号的选项。现在用着的那一种铺底、标「当前」，
 * 不能点；其余每一项是一个按钮，点了就办，没有另外的提交。问过之后收成 `AnsweredQuestion`。
 */

export interface QuestionOption {
	key: string;
	label: string;
	description?: string;
	/** 现在用着的就是这一项。 */
	current?: boolean;
}

export function Question({
	question,
	options,
	onChoose,
}: {
	question: string;
	options: readonly QuestionOption[];
	/** 返回的 Promise 结束前，选项都不能再点：同一个选择不会办两次。 */
	onChoose: (key: string) => unknown;
}): ReactNode {
	const id = useId();
	const [choosing, setChoosing] = useState(false);
	const choose = async (key: string) => {
		setChoosing(true);
		try {
			await onChoose(key);
		} finally {
			setChoosing(false);
		}
	};
	return (
		<div className="ui-question">
			<p className="ui-question-text" id={id}>
				{question}
			</p>
			<fieldset aria-labelledby={id} className="ui-question-options">
				{options.map((option, i) => {
					const body = (
						<>
							<span className="ui-question-index">{i + 1}</span>
							<span className="ui-question-body">
								<span className="ui-question-label">
									{option.label}
									{option.current && (
										<Tag size="small" variant="outlined">
											当前
										</Tag>
									)}
								</span>
								{option.description && (
									<span className="ui-question-description">
										{option.description}
									</span>
								)}
							</span>
						</>
					);
					return option.current ? (
						<div
							aria-current="true"
							className="ui-question-option"
							data-current=""
							key={option.key}
						>
							{body}
						</div>
					) : (
						<button
							className="ui-question-option"
							disabled={choosing}
							key={option.key}
							onClick={() => void choose(option.key)}
							type="button"
						>
							{body}
						</button>
					);
				})}
			</fieldset>
		</div>
	);
}

/** 问过的一问：问话照常，答了哪一项淡一档；没答就只留问话。 */
export function AnsweredQuestion({
	question,
	answer,
}: {
	question: string;
	answer: string | null;
}): ReactNode {
	return (
		<div className="ui-question-answered">
			<p>{question}</p>
			{answer && <p className="ui-question-answer">{answer}</p>}
		</div>
	);
}
